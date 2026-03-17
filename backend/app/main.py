import asyncio
import io
import json
import uuid
import zipfile
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from .config import settings
from .database import get_db, init_db
from .models import Session, TranscriptSegment, Summary, ApiUsage
from .youtube import extract_video_id, get_video_metadata
from .services.processor import process_session, generate_summary
from .services.livestream import process_live_stream, subscribe_live, unsubscribe_live, request_stop
from .services.summary_export import summary_to_md, summary_to_docx
from .queue_manager import run_queued, queue_position


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="ParliWatch API", version="2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ──────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    youtube_url: str
    transcription_tier: str = "free"  # "free" | "mini" | "diarization"
    auto_summarize: bool = False


class SessionResponse(BaseModel):
    session_id: str
    metadata: dict
    status: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def to_srt(segments: list) -> str:
    lines = []
    for i, s in enumerate(segments, 1):
        def fmt(sec: float) -> str:
            h = int(sec // 3600)
            m = int(sec % 3600 // 60)
            ss = int(sec % 60)
            ms = int((sec % 1) * 1000)
            return f"{h:02d}:{m:02d}:{ss:02d},{ms:03d}"
        lines.append(f"{i}\n{fmt(s.start_time)} --> {fmt(s.end_time)}\n{s.text}\n")
    return "\n".join(lines)


def to_vtt(segments: list) -> str:
    lines = ["WEBVTT\n"]
    for s in segments:
        def fmt(sec: float) -> str:
            h = int(sec // 3600)
            m = int(sec % 3600 // 60)
            ss = int(sec % 60)
            ms = int((sec % 1) * 1000)
            return f"{h:02d}:{m:02d}:{ss:02d}.{ms:03d}"
        lines.append(f"{fmt(s.start_time)} --> {fmt(s.end_time)}\n{s.text}\n")
    return "\n".join(lines)


def safe_filename(title: str, fallback: str) -> str:
    """Turn a video title into a safe filename, falling back to the session id."""
    import re as _re
    name = (title or "").strip()
    # Strip characters that are illegal in Windows/macOS/Linux filenames
    name = _re.sub(r'[\\/:*?"<>|]', "", name)
    # Collapse whitespace / repeated spaces
    name = _re.sub(r"\s+", " ", name).strip()
    # Truncate to 120 chars to stay well under filesystem limits
    name = name[:120].rstrip()
    return name if name else fallback


def to_md(segments: list, session_title: str = "") -> str:
    """Markdown transcript with inline timecodes: **[H:MM:SS]** text."""
    def fmt(sec: float) -> str:
        h = int(sec // 3600)
        m = int(sec % 3600 // 60)
        s = int(sec % 60)
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

    lines = []
    if session_title:
        lines.append(f"# {session_title}\n")
    for seg in segments:
        tc = fmt(seg.start_time)
        speaker = f"**{seg.speaker_label}** " if seg.speaker_label else ""
        lines.append(f"**[{tc}]** {speaker}{seg.text}")
    return "\n\n".join(lines)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/api/sessions", response_model=SessionResponse)
async def create_session(
    req: SessionCreate,
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    video_id = extract_video_id(req.youtube_url)
    if not video_id:
        raise HTTPException(400, "Invalid YouTube URL")

    try:
        metadata = get_video_metadata(video_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

    session_id = str(uuid.uuid4())
    session = Session(
        id=session_id,
        youtube_url=req.youtube_url,
        video_id=video_id,
        title=metadata["title"],
        channel=metadata["channel"],
        duration=metadata["duration"],
        thumbnail_url=metadata["thumbnail"],
        upload_date=metadata["upload_date"],
        is_live=metadata["is_live"],
        was_live=metadata["was_live"],
        transcription_tier=req.transcription_tier,
        status="pending",
    )
    db.add(session)
    await db.commit()

    if metadata.get("is_live"):
        bg.add_task(process_live_stream, session_id, video_id)
    else:
        async def _queued_process():
            await run_queued(
                session_id,
                process_session(session_id, video_id, req.transcription_tier, req.auto_summarize),
            )
        bg.add_task(_queued_process)

    return SessionResponse(
        session_id=session_id,
        metadata=metadata,
        status="pending",
    )


@app.get("/api/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Session).order_by(Session.created_at.desc()).limit(50)
    )
    sessions = result.scalars().all()
    return [
        {
            "id": s.id,
            "title": s.title,
            "channel": s.channel,
            "duration": s.duration,
            "thumbnail_url": s.thumbnail_url,
            "status": s.status,
            "transcription_tier": s.transcription_tier,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "queue_position": queue_position(s.id),
        }
        for s in sessions
    ]


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    return {
        "id": session.id,
        "youtube_url": session.youtube_url,
        "video_id": session.video_id,
        "title": session.title,
        "channel": session.channel,
        "duration": session.duration,
        "thumbnail_url": session.thumbnail_url,
        "upload_date": session.upload_date,
        "is_live": session.is_live,
        "status": session.status,
        "transcript_source": session.transcript_source,
        "transcription_tier": session.transcription_tier,
        "error_message": session.error_message,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "queue_position": queue_position(session.id),
    }


@app.get("/api/sessions/{session_id}/transcript")
async def get_transcript(
    session_id: str,
    format: str = "json",
    db: AsyncSession = Depends(get_db),
):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.session_id == session_id)
        .order_by(TranscriptSegment.start_time)
    )
    segments = result.scalars().all()

    fname = safe_filename(session.title or "", session_id)
    if format == "srt":
        return Response(to_srt(segments), media_type="text/plain",
                        headers={"Content-Disposition": f'attachment; filename="{fname}.srt"'})
    if format == "vtt":
        return Response(to_vtt(segments), media_type="text/vtt",
                        headers={"Content-Disposition": f'attachment; filename="{fname}.vtt"'})
    if format == "txt":
        text = "\n".join(s.text for s in segments)
        return Response(text, media_type="text/plain",
                        headers={"Content-Disposition": f'attachment; filename="{fname}.txt"'})
    if format == "md":
        return Response(to_md(segments, session.title or ""), media_type="text/markdown",
                        headers={"Content-Disposition": f'attachment; filename="{fname}.md"'})

    return [
        {
            "id": s.id,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "text": s.text,
            "speaker_label": s.speaker_label,
            "confidence": s.confidence,
            "source": s.source,
            "is_edited": s.is_edited,
        }
        for s in segments
    ]


@app.get("/api/sessions/{session_id}/summary")
async def get_summary(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(Summary).where(Summary.session_id == session_id)
    )
    summary = result.scalar_one_or_none()
    if not summary:
        raise HTTPException(404, "Summary not yet generated")

    return {
        "executive_summary": summary.executive_summary,
        "topics": summary.topics,
        "decisions": summary.decisions,
        "actions": summary.actions,
        "speakers": summary.speakers,
        "created_at": summary.created_at.isoformat() if summary.created_at else None,
    }


@app.post("/api/sessions/{session_id}/summarize")
async def trigger_summarize(
    session_id: str,
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.status not in ("complete",):
        raise HTTPException(400, "Transcript must be complete before summarizing")

    bg.add_task(generate_summary, session_id)
    return {"status": "summarizing", "session_id": session_id}


@app.post("/api/sessions/{session_id}/retry")
async def retry_session(session_id: str, bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    """Reset a failed session and re-queue its transcription job."""
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.status != "failed":
        raise HTTPException(400, f"Only failed sessions can be retried (current status: '{session.status}')")

    session.status = "pending"
    session.error_message = None
    await db.commit()

    async def _queued_retry():
        await run_queued(
            session_id,
            process_session(session_id, session.video_id, session.transcription_tier, False),
        )
    bg.add_task(_queued_retry)
    return {"status": "pending", "session_id": session_id}


@app.post("/api/sessions/{session_id}/stop")
async def stop_live_stream(session_id: str, db: AsyncSession = Depends(get_db)):
    """Stop a live transcription session gracefully."""
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.status != "live":
        raise HTTPException(400, "Session is not currently live")

    request_stop(session_id)
    return {"status": "stopping", "session_id": session_id}


@app.get("/api/sessions/{session_id}/cost")
async def get_cost(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ApiUsage).where(ApiUsage.session_id == session_id)
    )
    usages = result.scalars().all()
    total = sum(u.cost_usd or 0 for u in usages)
    return {
        "total_cost_usd": round(total, 4),
        "breakdown": [
            {
                "provider": u.provider,
                "model": u.model,
                "minutes_processed": u.minutes_processed,
                "cost_usd": u.cost_usd,
            }
            for u in usages
        ],
    }


@app.get("/api/sessions/{session_id}/live-transcript")
async def live_transcript_sse(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Server-Sent Events endpoint for real-time live transcript updates.
    The client connects here and receives segments as they are transcribed.
    """
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    queue = subscribe_live(session_id)

    async def event_generator():
        try:
            while True:
                # Check if client has disconnected
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"data: {json.dumps(msg)}\n\n"
                    if msg.get("type") in ("done", "error"):
                        break
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        finally:
            unsubscribe_live(session_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/sessions/{session_id}/summary/download")
async def download_summary(
    session_id: str,
    format: str = "md",
    db: AsyncSession = Depends(get_db),
):
    """Download the AI summary as Markdown or DOCX."""
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    result = await db.execute(select(Summary).where(Summary.session_id == session_id))
    summary = result.scalar_one_or_none()
    if not summary:
        raise HTTPException(404, "Summary not yet generated")

    summary_dict = {
        "executive_summary": summary.executive_summary,
        "topics": summary.topics or [],
        "decisions": summary.decisions or [],
        "actions": summary.actions or [],
        "speakers": summary.speakers or [],
    }
    fname = safe_filename(session.title or "", session_id)

    if format == "docx":
        data = summary_to_docx(summary_dict, session.title or "")
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return Response(
            data, media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{fname} - Summary.docx"'},
        )

    # Default: markdown
    text = summary_to_md(summary_dict, session.title or "")
    return Response(
        text, media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{fname} - Summary.md"'},
    )


@app.get("/api/sessions/{session_id}/export/bundle")
async def export_bundle(session_id: str, db: AsyncSession = Depends(get_db)):
    """Download a ZIP containing all transcript formats plus summary (MD + DOCX)."""
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    seg_result = await db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.session_id == session_id)
        .order_by(TranscriptSegment.start_time)
    )
    segments = seg_result.scalars().all()

    sum_result = await db.execute(select(Summary).where(Summary.session_id == session_id))
    summary = sum_result.scalar_one_or_none()

    fname = safe_filename(session.title or "", session_id)
    title = session.title or ""

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Transcript formats
        zf.writestr(f"{fname} - Transcript.md", to_md(segments, title))
        zf.writestr(f"{fname} - Transcript.srt", to_srt(segments))
        zf.writestr(f"{fname} - Transcript.txt", "\n".join(s.text for s in segments))

        # Summary formats (if available)
        if summary:
            summary_dict = {
                "executive_summary": summary.executive_summary,
                "topics": summary.topics or [],
                "decisions": summary.decisions or [],
                "actions": summary.actions or [],
                "speakers": summary.speakers or [],
            }
            zf.writestr(f"{fname} - Summary.md", summary_to_md(summary_dict, title))
            zf.writestr(
                f"{fname} - Summary.docx",
                summary_to_docx(summary_dict, title),
            )

    buf.seek(0)
    return Response(
        buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}.zip"'},
    )


@app.get("/api/preview")
async def preview_url(url: str):
    """
    Fetch lightweight metadata (title, thumbnail, channel, duration) for a
    YouTube URL without creating a session.  Used by the frontend to show a
    confirmation card before the user submits.
    """
    video_id = extract_video_id(url)
    if not video_id:
        raise HTTPException(400, "Invalid YouTube URL")
    try:
        metadata = get_video_metadata(video_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "video_id": video_id,
        "title": metadata.get("title"),
        "channel": metadata.get("channel"),
        "thumbnail": metadata.get("thumbnail"),
        "duration": metadata.get("duration"),
        "is_live": metadata.get("is_live", False),
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "2.0"}
