import anthropic
import json
import logging
import re
import time
from ..config import settings

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _parse_claude_json(text: str) -> dict:
    """Parse JSON from a Claude response, stripping markdown fences if present."""
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ``` wrappers
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()
    if not text:
        raise ValueError("Claude returned an empty response")
    return json.loads(text)

SUMMARY_SYSTEM_PROMPT = """You are an expert parliamentary analyst. Given a time-coded transcript from a parliamentary session, produce a structured JSON analysis:

1. "executive_summary": 150-300 word overview of the session's key business.

2. "topics": Array of topic segments:
   - "title": Descriptive topic name
   - "start_time": Start timestamp (seconds)
   - "end_time": End timestamp (seconds)
   - "summary": 2-4 sentence summary
   - "speakers": List of speakers who contributed

3. "decisions": Array of formal decisions/votes:
   - "description": What was decided
   - "outcome": "passed" | "defeated" | "deferred" | "withdrawn"
   - "timestamp": When it occurred (seconds)

4. "actions": Array of commitments/action items:
   - "description": What was committed to
   - "responsible": Who made the commitment
   - "timestamp": seconds

5. "speakers": Per-speaker summary:
   - "name": Speaker name/title
   - "role": If identifiable
   - "key_positions": Array of 1-2 sentence position summaries

RULES:
- NEVER fabricate quotes. Only attribute statements that exist in the transcript.
- All timestamps must reference actual transcript segment times.
- Return ONLY valid JSON. No markdown fences, no preamble."""


def format_transcript(segments: list[dict]) -> str:
    lines = []
    for s in segments:
        t = s["start_time"]
        ts = f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d}"
        speaker = s.get("speaker_label") or "SPEAKER"
        lines.append(f"[{ts}] {speaker}: {s['text']}")
    return "\n".join(lines)


def _summarize_single_with_retry(formatted: str, metadata: dict, max_retries: int = 3) -> tuple[dict, float]:
    """Summarize a short-enough transcript in one shot, retrying on bad JSON."""
    cost = 0.0
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=8000,
                system=SUMMARY_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Session: {metadata.get('title', 'Unknown')}\n"
                            f"Channel: {metadata.get('channel', 'Unknown')}\n"
                            f"Duration: {metadata.get('duration', 0)}s\n\n"
                            f"TRANSCRIPT:\n{formatted}"
                        ),
                    }
                ],
            )
            raw = response.content[0].text if response.content else ""
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            cost += (input_tokens * 3 / 1_000_000) + (output_tokens * 15 / 1_000_000)
            return _parse_claude_json(raw), cost
        except (ValueError, json.JSONDecodeError) as exc:
            last_exc = exc
            raw_preview = repr(raw[:300]) if "raw" in dir() else "n/a"
            logger.warning(
                f"[summarizer] single attempt {attempt + 1}/{max_retries} failed: {exc} | raw={raw_preview}"
            )
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    logger.error(f"[summarizer] all {max_retries} single-shot attempts failed: {last_exc}")
    raise ValueError(f"Summary generation failed after {max_retries} attempts: {last_exc}") from last_exc


def summarize_session(session_id: str, segments: list[dict], metadata: dict) -> dict:
    formatted = format_transcript(segments)

    if len(formatted) > 120_000:
        return _chunked_summarization(segments, metadata)

    return _summarize_single_with_retry(formatted, metadata)


def _summarize_chunk_with_retry(formatted: str, max_retries: int = 3) -> tuple[dict, float]:
    """Summarize one transcript chunk, retrying up to max_retries on bad JSON."""
    cost = 0.0
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=3000,
                system=(
                    "You are a parliamentary transcript analyst. "
                    "Summarize this section. "
                    "YOU MUST respond with ONLY valid JSON — no preamble, no explanation:\n"
                    '{"topic_title":"...","summary":"...","decisions":[],"actions":[],"speakers":[]}'
                ),
                messages=[{"role": "user", "content": formatted}],
            )
            raw = response.content[0].text if response.content else ""
            input_t = response.usage.input_tokens
            output_t = response.usage.output_tokens
            cost += (input_t * 0.8 / 1_000_000) + (output_t * 4 / 1_000_000)
            return _parse_claude_json(raw), cost
        except (ValueError, json.JSONDecodeError) as exc:
            last_exc = exc
            raw_preview = repr(raw[:300]) if "raw" in dir() else "n/a"
            logger.warning(
                f"[summarizer] chunk attempt {attempt + 1}/{max_retries} failed: {exc} | raw={raw_preview}"
            )
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    logger.error(f"[summarizer] all {max_retries} chunk attempts failed: {last_exc}")
    return {
        "topic_title": "Section Unavailable",
        "summary": "Automatic summarization failed for this section.",
        "decisions": [],
        "actions": [],
        "speakers": [],
    }, cost


def _chunked_summarization(segments: list[dict], metadata: dict) -> tuple[dict, float]:
    """For sessions exceeding context limits: chunk → summarize → assemble."""
    chunks = _split_by_time(segments, target_minutes=20)
    chunk_summaries = []
    total_cost = 0.0

    for i, chunk in enumerate(chunks):
        formatted = format_transcript(chunk)
        summary_dict, chunk_cost = _summarize_chunk_with_retry(formatted)
        chunk_summaries.append(summary_dict)
        total_cost += chunk_cost
        logger.info(f"[summarizer] chunk {i + 1}/{len(chunks)} done")

    assembly_prompt = (
        f"Assemble these {len(chunk_summaries)} section summaries "
        f"from '{metadata.get('title', 'Unknown')}' into a unified summary.\n\n"
        f"{json.dumps(chunk_summaries, indent=2)}"
    )

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            assembly = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=8000,
                system=SUMMARY_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": assembly_prompt}],
            )
            raw = assembly.content[0].text if assembly.content else ""
            result = _parse_claude_json(raw)
            input_t = assembly.usage.input_tokens
            output_t = assembly.usage.output_tokens
            total_cost += (input_t * 3 / 1_000_000) + (output_t * 15 / 1_000_000)
            return result, total_cost
        except (ValueError, json.JSONDecodeError) as exc:
            last_exc = exc
            raw_preview = repr(raw[:300]) if "raw" in dir() else "n/a"
            logger.warning(f"[summarizer] assembly attempt {attempt + 1}/3 failed: {exc} | raw={raw_preview}")
            if attempt < 2:
                time.sleep(2 ** attempt)

    logger.error(f"[summarizer] assembly failed after 3 attempts: {last_exc}")
    raise ValueError(f"Summary assembly failed after 3 attempts: {last_exc}") from last_exc


def _split_by_time(segments: list[dict], target_minutes: int = 20) -> list[list[dict]]:
    target_seconds = target_minutes * 60
    chunks: list[list[dict]] = []
    current: list[dict] = []
    chunk_start = segments[0]["start_time"] if segments else 0

    for seg in segments:
        current.append(seg)
        if seg["end_time"] - chunk_start >= target_seconds:
            chunks.append(current)
            current = []
            chunk_start = seg["end_time"]

    if current:
        chunks.append(current)

    return chunks
