"""
Simple in-memory queue for recorded transcription jobs.

Only one recorded session is processed at a time.  Live streams bypass the
queue entirely (they're real-time and must start immediately).
"""
import asyncio
from typing import Coroutine, Any

_sem: asyncio.Semaphore | None = None
_waiting: list[str] = []   # session IDs waiting for the semaphore


def _get_sem() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(1)
    return _sem


async def run_queued(session_id: str, coro: Coroutine[Any, Any, None]) -> None:
    """
    Run *coro* once the single processing slot is free.
    The session ID is tracked in *_waiting* while it sits in the queue so the
    frontend can show queue position.
    """
    _waiting.append(session_id)
    try:
        async with _get_sem():
            # We have the slot — remove from waiting list
            try:
                _waiting.remove(session_id)
            except ValueError:
                pass
            await coro
    finally:
        # Safety net: ensure cleanup even if something goes wrong
        try:
            _waiting.remove(session_id)
        except ValueError:
            pass


def queue_position(session_id: str) -> int:
    """Return 1-based queue position, or 0 if not queued / already running."""
    try:
        return _waiting.index(session_id) + 1
    except ValueError:
        return 0


def active_count() -> int:
    """Number of sessions currently waiting in queue."""
    return len(_waiting)
