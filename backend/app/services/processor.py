import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from ..models import Session, TranscriptSegment, Summary, ApiUsage
from ..database import AsyncSessionLocal
from .transcript import extract_youtube_captions
from .audio import download_audio, get_audio_duration, cleanup_audio
from .groq_transcribe import transcribe_with_groq, estimate_cost, MODEL_STANDARD, MODEL_ACCURATE
from .summarizer import summarize_session

logger = logging.getLogger(__name__)


async def _update_status(session_id: str, status: str, error: str = None):
    async with AsyncSessionLocal() as db:
        values = {"status": status}
        if error:
            values["error_message"] = error
        await db.execute(
            update(Session).where(Session.id == session_id).values(**values)
        )
        await db.commit()


async def _save_segments(db: AsyncSession, session_id: str, segments: list[dict], source: str):
    # Remove existing segments
    existing = await db.execute(
        select(TranscriptSegment).where(TranscriptSegment.session_id == session_id)
    )
    for seg in existing.scalars():
        await db.delete(seg)

    for seg in segments:
        db.add(TranscriptSegment(
            session_id=session_id,
            start_time=seg["start_time"],
            end_time=seg["end_time"],
            text=seg["text"],
            speaker_label=seg.get("speaker_label"),
            confidence=seg.get("confidence"),
            source=seg.get("source", source),
        ))
    await db.commit()


async def _save_api_usage(
    db: AsyncSession, session_id: str, provider: str,
    model: str, minutes: float, cost: float
):
    db.add(ApiUsage(
        session_id=session_id,
        provider=provider,
        model=model,
        minutes_processed=minutes,
        cost_usd=cost,
    ))
    await db.commit()


async def process_session(session_id: str, video_id: str, tier: str, auto_summarize: bool = False):
    """Main processing pipeline — free captions or OpenAI API."""
    try:
        await _update_status(session_id, "extracting")

        if tier == "free":
            # Run blocking IO in thread pool
            segments = await asyncio.get_event_loop().run_in_executor(
                None, extract_youtube_captions, video_id
            )
            if not segments:
                await _update_status(
                    session_id, "failed",
                    "No YouTube captions available. Try Enhanced transcription."
                )
                return
            source = "youtube_captions"

            async with AsyncSessionLocal() as db:
                await _save_segments(db, session_id, segments, source)
                await db.execute(
                    update(Session)
                    .where(Session.id == session_id)
                    .values(status="complete", transcript_source=source)
                )
                await db.commit()

        else:
            await _update_status(session_id, "transcribing")
            audio_path = await asyncio.get_event_loop().run_in_executor(
                None, download_audio, video_id
            )

            try:
                model = MODEL_STANDARD if tier == "mini" else MODEL_ACCURATE

                segments = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: transcribe_with_groq(audio_path, model)
                )
                source = f"groq_{tier}"

                duration = get_audio_duration(audio_path)
                cost = estimate_cost(duration, model)

                async with AsyncSessionLocal() as db:
                    await _save_segments(db, session_id, segments, source)
                    await _save_api_usage(db, session_id, "groq", model, duration / 60, cost)
                    await db.execute(
                        update(Session)
                        .where(Session.id == session_id)
                        .values(status="complete", transcript_source=source)
                    )
                    await db.commit()

            finally:
                cleanup_audio(audio_path)

        if auto_summarize:
            await generate_summary(session_id)

    except Exception as e:
        logger.exception(f"process_session failed for {session_id}")
        await _update_status(session_id, "failed", str(e))


async def generate_summary(session_id: str):
    """Trigger AI summarization after transcript is ready."""
    try:
        await _update_status(session_id, "summarizing")

        async with AsyncSessionLocal() as db:
            session_row = await db.get(Session, session_id)
            if not session_row:
                return

            result = await db.execute(
                select(TranscriptSegment)
                .where(TranscriptSegment.session_id == session_id)
                .order_by(TranscriptSegment.start_time)
            )
            segments = [
                {
                    "start_time": s.start_time,
                    "end_time": s.end_time,
                    "text": s.text,
                    "speaker_label": s.speaker_label,
                }
                for s in result.scalars()
            ]

            metadata = {
                "title": session_row.title,
                "channel": session_row.channel,
                "duration": session_row.duration,
            }

        summary_data, cost = await asyncio.get_event_loop().run_in_executor(
            None, lambda: summarize_session(session_id, segments, metadata)
        )

        async with AsyncSessionLocal() as db:
            existing = await db.execute(
                select(Summary).where(Summary.session_id == session_id)
            )
            existing_summary = existing.scalar_one_or_none()
            if existing_summary:
                await db.delete(existing_summary)

            db.add(Summary(
                session_id=session_id,
                executive_summary=summary_data.get("executive_summary"),
                topics=summary_data.get("topics", []),
                decisions=summary_data.get("decisions", []),
                actions=summary_data.get("actions", []),
                speakers=summary_data.get("speakers", []),
            ))
            await _save_api_usage(db, session_id, "anthropic", "claude-sonnet-4", 0, cost)
            await db.execute(
                update(Session)
                .where(Session.id == session_id)
                .values(status="complete")
            )
            await db.commit()

    except Exception as e:
        logger.exception(f"generate_summary failed for {session_id}")
        # Keep the session as "complete" — the transcript is already saved.
        # Only the summary failed; the user can retry it manually from the session page.
        await _update_status(session_id, "complete")
