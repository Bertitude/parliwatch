"""
Phase 4: Real-time live stream transcription.

Pipeline:
  1. yt-dlp  → HLS manifest URL
  2. ffmpeg  → 30-second WAV chunks (segment muxer)
  3. Groq    → TranscriptSegments (timestamps offset into stream)
  4. SSE     → connected frontend clients via asyncio.Queue pub-sub
"""

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
import threading
from subprocess import Popen, DEVNULL, PIPE

from sqlalchemy import update

from ..database import AsyncSessionLocal
from ..models import Session, TranscriptSegment
from .groq_transcribe import MODEL_STANDARD, transcribe_with_groq

logger = logging.getLogger(__name__)

COOKIES_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "cookies.txt")
)
CHUNK_SECONDS = 30


# ── SSE pub-sub ────────────────────────────────────────────────────────────────
# session_id → list of per-client asyncio.Queue
_subscribers: dict[str, list[asyncio.Queue]] = {}

# ── Stop / pause control ───────────────────────────────────────────────────────
# session_ids for which a stop has been requested
_stop_requested: set[str] = set()


def request_stop(session_id: str) -> None:
    """Signal the live-stream loop for this session to stop gracefully."""
    _stop_requested.add(session_id)


def _clear_stop(session_id: str) -> None:
    _stop_requested.discard(session_id)


def subscribe_live(session_id: str) -> asyncio.Queue:
    """Create and register a new SSE subscriber queue."""
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(session_id, []).append(q)
    return q


def unsubscribe_live(session_id: str, q: asyncio.Queue) -> None:
    """Remove a subscriber queue when the client disconnects."""
    listeners = _subscribers.get(session_id, [])
    try:
        listeners.remove(q)
    except ValueError:
        pass
    if not listeners:
        _subscribers.pop(session_id, None)


async def _broadcast(session_id: str, msg: dict) -> None:
    for q in list(_subscribers.get(session_id, [])):
        await q.put(msg)


# ── DB helpers ─────────────────────────────────────────────────────────────────

async def _update_status(session_id: str, status: str, error: str | None = None) -> None:
    async with AsyncSessionLocal() as db:
        values: dict = {"status": status}
        if error:
            values["error_message"] = error
        await db.execute(
            update(Session).where(Session.id == session_id).values(**values)
        )
        await db.commit()


async def _append_segments(
    session_id: str,
    segments: list[dict],
    source: str = "live_groq",
) -> None:
    """Append segments without deleting existing ones (live accumulation)."""
    async with AsyncSessionLocal() as db:
        for seg in segments:
            db.add(TranscriptSegment(
                session_id=session_id,
                start_time=seg["start_time"],
                end_time=seg["end_time"],
                text=seg["text"],
                speaker_label=seg.get("speaker_label"),
                confidence=seg.get("confidence"),
                source=source,
            ))
        await db.commit()


# ── yt-dlp / ffmpeg helpers ────────────────────────────────────────────────────

def _get_hls_url(video_id: str, from_start: bool = True) -> str:
    """Resolve the best-audio HLS URL from a live YouTube stream.

    from_start=True: begin from the DVR window start (transcribes backlog too).
    from_start=False: begin from the live edge only.
    """
    cmd = [
        "yt-dlp", "-f", "bestaudio/best",
        "--get-url", "--no-check-formats",
    ]
    if from_start:
        cmd.append("--live-from-start")
    if os.path.exists(COOKIES_PATH):
        cmd += ["--cookies", COOKIES_PATH]
    cmd.append(f"https://www.youtube.com/watch?v={video_id}")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    lines = result.stdout.strip().splitlines()
    url = lines[0] if lines else ""
    if not url:
        raise RuntimeError(f"Could not resolve HLS URL: {result.stderr[:300]}")
    return url


def _transcribe_chunk(chunk_path: str, time_offset: float) -> list[dict]:
    """Transcribe one WAV chunk, shifting timestamps by time_offset seconds."""
    raw = transcribe_with_groq(chunk_path, MODEL_STANDARD)
    return [
        {
            **seg,
            "start_time": seg["start_time"] + time_offset,
            "end_time":   seg["end_time"]   + time_offset,
        }
        for seg in raw
    ]


# ── Backfill: transcribe content captured before live transcription started ───

async def _backfill_stream(
    session_id: str,
    video_id: str,
    stream_elapsed: float,
) -> None:
    """
    Concurrently capture and transcribe the portion of the stream that existed
    before live transcription started.

    Uses --live-from-start to obtain the DVR-origin HLS URL, then limits
    ffmpeg output to (stream_elapsed - CHUNK_SECONDS) seconds so the backfill
    window ends before the live pipeline begins — avoiding any overlap.

    Failure is non-fatal: the live pipeline continues regardless.
    """
    capture_duration = max(0.0, stream_elapsed - CHUNK_SECONDS)
    if capture_duration < CHUNK_SECONDS:
        print(
            f"[backfill] stream_elapsed={stream_elapsed:.0f}s — nothing meaningful to backfill",
            flush=True,
        )
        return

    chunk_dir = tempfile.mkdtemp(prefix="parliwatch_backfill_")
    ffmpeg_proc: Popen | None = None

    try:
        await _broadcast(session_id, {
            "type": "backfill_start",
            "duration": int(capture_duration),
        })
        print(
            f"[backfill] starting for {session_id}, capturing {capture_duration:.0f}s "
            f"(stream_elapsed={stream_elapsed:.0f}s)",
            flush=True,
        )

        hls_url = await asyncio.get_running_loop().run_in_executor(
            None, lambda: _get_hls_url(video_id, from_start=True)
        )
        print(f"[backfill] HLS URL resolved: {hls_url[:80]}...", flush=True)

        chunk_pattern = os.path.join(chunk_dir, "chunk_%03d.wav")
        ffmpeg_stderr_lines: list[str] = []

        ffmpeg_proc = Popen(
            [
                "ffmpeg", "-y",
                "-i", hls_url,
                "-t", str(int(capture_duration)),   # stop after backfill window
                "-f", "segment",
                "-segment_time", str(CHUNK_SECONDS),
                "-ar", "16000", "-ac", "1",
                "-reset_timestamps", "1",
                chunk_pattern,
            ],
            stdout=DEVNULL,
            stderr=PIPE,
        )

        def _drain_backfill_stderr():
            for raw in ffmpeg_proc.stderr:
                ffmpeg_stderr_lines.append(raw.decode(errors="replace").rstrip())

        threading.Thread(target=_drain_backfill_stderr, daemon=True).start()

        await asyncio.sleep(5)
        rc = ffmpeg_proc.poll()
        if rc is not None:
            stderr_tail = "\n".join(ffmpeg_stderr_lines[-10:])
            raise RuntimeError(
                f"backfill ffmpeg exited immediately (rc={rc}): {stderr_tail[:300]}"
            )
        print(f"[backfill] ffmpeg running OK", flush=True)

        chunk_index = 0
        time_offset = 0.0

        while True:
            if session_id in _stop_requested:
                break

            chunk_path = os.path.join(chunk_dir, f"chunk_{chunk_index:03d}.wav")
            next_chunk = os.path.join(chunk_dir, f"chunk_{chunk_index + 1:03d}.wav")

            # Wait for chunk to be complete (next chunk exists, or ffmpeg finished)
            for _ in range(180):
                if session_id in _stop_requested:
                    break
                if os.path.exists(next_chunk) or ffmpeg_proc.poll() is not None:
                    break
                await asyncio.sleep(0.5)

            if not os.path.exists(chunk_path):
                break

            try:
                segments = await asyncio.get_running_loop().run_in_executor(
                    None,
                    lambda p=chunk_path, o=time_offset: _transcribe_chunk(p, o),
                )
                if segments:
                    await _append_segments(session_id, segments, source="backfill_groq")
                    await _broadcast(session_id, {
                        "type": "backfill_segments",
                        "data": segments,
                        "processed_seconds": int(time_offset + CHUNK_SECONDS),
                        "total_seconds": int(capture_duration),
                    })
                    print(
                        f"[backfill] chunk {chunk_index}: {len(segments)} segs "
                        f"at offset {time_offset:.0f}s",
                        flush=True,
                    )
            except Exception as exc:
                print(f"[backfill] chunk {chunk_index} transcription error: {exc}", flush=True)
                logger.warning(f"[backfill] chunk {chunk_index} error: {exc}")

            time_offset += CHUNK_SECONDS
            chunk_index += 1

            if ffmpeg_proc.poll() is not None and not os.path.exists(next_chunk):
                break

        await _broadcast(session_id, {
            "type": "backfill_complete",
            "chunks_processed": chunk_index,
            "total_seconds": int(capture_duration),
        })
        print(
            f"[backfill] complete for {session_id} — {chunk_index} chunks processed",
            flush=True,
        )

    except Exception as exc:
        print(f"[backfill] failed for {session_id}: {exc}", flush=True)
        logger.warning(f"[backfill] failed for {session_id}: {exc}")
        # Backfill failure is non-fatal — broadcast so the UI can reflect it,
        # but do NOT set the session status to failed.
        await _broadcast(session_id, {
            "type": "backfill_error",
            "message": str(exc),
        })

    finally:
        if ffmpeg_proc and ffmpeg_proc.poll() is None:
            ffmpeg_proc.terminate()
            try:
                ffmpeg_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                ffmpeg_proc.kill()
        shutil.rmtree(chunk_dir, ignore_errors=True)


# ── Main live-stream processing loop ──────────────────────────────────────────

async def process_live_stream(session_id: str, video_id: str, stream_elapsed: float = 0.0) -> None:
    """
    Background task: capture a live YouTube stream in 30-second chunks,
    transcribe each with Groq, persist to DB, and broadcast via SSE.
    """
    chunk_dir = tempfile.mkdtemp(prefix="parliwatch_live_")
    ffmpeg_proc: Popen | None = None
    backfill_task: asyncio.Task | None = None

    _clear_stop(session_id)

    try:
        await _update_status(session_id, "live")
        print(
            f"[live] status set to live for {session_id} "
            f"(stream_elapsed={stream_elapsed:.0f}s)",
            flush=True,
        )

        # 1. Launch backfill concurrently if the stream was already running
        if stream_elapsed > CHUNK_SECONDS:
            backfill_task = asyncio.create_task(
                _backfill_stream(session_id, video_id, stream_elapsed)
            )
            print(f"[live] backfill task started for {stream_elapsed:.0f}s of prior content", flush=True)

        # 2. Get the live-edge HLS URL for the forward-going pipeline
        print(f"[live] fetching HLS URL for {video_id}...", flush=True)
        hls_url = await asyncio.get_running_loop().run_in_executor(
            None, lambda: _get_hls_url(video_id, from_start=False)
        )
        print(f"[live] HLS URL resolved: {hls_url[:80]}...", flush=True)

        chunk_pattern = os.path.join(chunk_dir, "chunk_%03d.wav")

        # 3. Launch ffmpeg using Popen (non-blocking, Windows-compatible)
        print(f"[live] starting ffmpeg, chunk_dir={chunk_dir}", flush=True)
        ffmpeg_stderr_lines: list[str] = []

        ffmpeg_proc = Popen(
            [
                "ffmpeg", "-y",
                "-i", hls_url,
                "-f", "segment",
                "-segment_time", str(CHUNK_SECONDS),
                "-ar", "16000", "-ac", "1",
                "-reset_timestamps", "1",
                chunk_pattern,
            ],
            stdout=DEVNULL,
            stderr=PIPE,
        )
        print(f"[live] ffmpeg started pid={ffmpeg_proc.pid}", flush=True)

        # Drain ffmpeg stderr in a background thread to prevent pipe buffer deadlock.
        # (On Windows, a full 64 KB pipe buffer causes ffmpeg to block indefinitely.)
        def _drain_stderr():
            for raw in ffmpeg_proc.stderr:
                line = raw.decode(errors="replace").rstrip()
                ffmpeg_stderr_lines.append(line)

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()

        # Give ffmpeg 5 seconds to start, then check it hasn't immediately died
        await asyncio.sleep(5)
        rc = ffmpeg_proc.poll()
        if rc is not None:
            stderr_tail = "\n".join(ffmpeg_stderr_lines[-20:])
            print(f"[live] ffmpeg died immediately rc={rc}\nSTDERR:\n{stderr_tail}", flush=True)
            raise RuntimeError(f"ffmpeg exited immediately (rc={rc}): {stderr_tail[:300]}")
        print(f"[live] ffmpeg still running after 5s check OK", flush=True)

        chunk_index = 0
        # time_offset starts at stream_elapsed so all live segments carry
        # absolute stream timestamps that align with backfill segments.
        time_offset = stream_elapsed

        # 4. Process each chunk as it becomes complete
        while True:
            # Check for stop request before each chunk
            if session_id in _stop_requested:
                print(f"[live] stop requested for {session_id} — shutting down", flush=True)
                break

            chunk_path = os.path.join(chunk_dir, f"chunk_{chunk_index:03d}.wav")
            next_chunk = os.path.join(chunk_dir, f"chunk_{chunk_index + 1:03d}.wav")

            print(f"[live] waiting for chunk {chunk_index+1} (ffmpeg rc={ffmpeg_proc.poll()})", flush=True)

            # A chunk is complete when ffmpeg begins writing the next one.
            # Poll up to 90 seconds (3× the chunk length) before giving up.
            for i in range(180):
                if session_id in _stop_requested:
                    break
                if os.path.exists(next_chunk):
                    print(f"[live] next chunk appeared after {i*0.5:.0f}s", flush=True)
                    break
                rc = ffmpeg_proc.poll()
                if rc is not None:
                    stderr_tail = "\n".join(ffmpeg_stderr_lines[-20:])
                    print(f"[live] ffmpeg exited rc={rc} at {i*0.5:.0f}s\nSTDERR tail:\n{stderr_tail}", flush=True)
                    break
                if i > 0 and i % 20 == 0:
                    import glob as _glob
                    files = [os.path.basename(f) for f in _glob.glob(os.path.join(chunk_dir, "*.wav"))]
                    sizes = {os.path.basename(f): os.path.getsize(f) for f in _glob.glob(os.path.join(chunk_dir, "*.wav"))}
                    print(f"[live] t={i*0.5:.0f}s waiting... files={files} sizes={sizes}", flush=True)
                await asyncio.sleep(0.5)

            print(f"[live] loop exit: chunk0={os.path.exists(chunk_path)}, chunk1={os.path.exists(next_chunk)}, ffmpeg_rc={ffmpeg_proc.poll()}", flush=True)

            if os.path.exists(chunk_path):
                try:
                    print(f"[live] transcribing chunk {chunk_index} ({os.path.getsize(chunk_path)} bytes)...", flush=True)
                    segments = await asyncio.get_running_loop().run_in_executor(
                        None,
                        lambda p=chunk_path, o=time_offset: _transcribe_chunk(p, o),
                    )
                    print(f"[live] chunk {chunk_index}: got {len(segments)} segments", flush=True)
                    if segments:
                        await _append_segments(session_id, segments)
                        await _broadcast(session_id, {"type": "segments", "data": segments})
                except Exception as exc:
                    print(f"[live] chunk {chunk_index} transcription ERROR: {exc}", flush=True)
                    logger.warning(f"[live] chunk {chunk_index} transcription error: {exc}")

            time_offset += CHUNK_SECONDS
            chunk_index += 1

            # Exit when ffmpeg is done and there are no more unprocessed chunks
            if ffmpeg_proc.poll() is not None and not os.path.exists(next_chunk):
                break

        await _update_status(session_id, "complete")
        await _broadcast(session_id, {"type": "done"})
        logger.info(f"[live] session {session_id} complete")

    except Exception as exc:
        logger.exception(f"[live] process_live_stream failed for {session_id}")
        await _update_status(session_id, "failed", str(exc))
        await _broadcast(session_id, {"type": "error", "message": str(exc)})

    finally:
        _clear_stop(session_id)
        # Cancel backfill if it is still running (e.g. session was stopped early)
        if backfill_task and not backfill_task.done():
            backfill_task.cancel()
            try:
                await backfill_task
            except asyncio.CancelledError:
                pass
        # Ensure ffmpeg is terminated (Popen.poll() returns None if still running)
        if ffmpeg_proc and ffmpeg_proc.poll() is None:
            ffmpeg_proc.terminate()
            try:
                ffmpeg_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                ffmpeg_proc.kill()
        shutil.rmtree(chunk_dir, ignore_errors=True)
