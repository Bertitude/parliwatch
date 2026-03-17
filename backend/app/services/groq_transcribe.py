from groq import Groq
from ..config import settings
from .audio import split_audio, get_audio_duration

client = Groq(api_key=settings.groq_api_key)

BARBADOS_PARLIAMENT_PROMPT = (
    "Parliamentary session, Barbados House of Assembly. "
    "Honourable members, Speaker, Prime Minister, Opposition Leader, "
    "Minister of Finance, Bridgetown, St. Michael, Christ Church, "
    "St. James, St. Philip, constituency, Senate, Bajan."
)

# Groq Whisper models
MODEL_STANDARD = "whisper-large-v3-turbo"   # $0.00004/min — fast, cheap
MODEL_ACCURATE = "whisper-large-v3"          # $0.00011/min — most accurate


def transcribe_with_groq(
    audio_path: str,
    model: str = MODEL_STANDARD,
) -> list[dict]:
    """
    Tier 2: Groq Whisper API transcription.
    - whisper-large-v3-turbo: ~$0.00004/min (mini tier)
    - whisper-large-v3:       ~$0.00011/min (accurate tier)
    Note: Groq does not support speaker diarization via Whisper.
    """
    chunks = split_audio(audio_path)
    all_segments: list[dict] = []
    cumulative_offset = 0.0

    for i, chunk_path in enumerate(chunks):
        with open(chunk_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=model,
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
                language="en",
                prompt=BARBADOS_PARLIAMENT_PROMPT,
            )

        for seg in (response.segments or []):
            # Groq SDK versions differ: some return objects, some return dicts
            if isinstance(seg, dict):
                s_start = seg["start"]
                s_end = seg["end"]
                s_text = seg["text"]
            else:
                s_start = seg.start
                s_end = seg.end
                s_text = seg.text
            all_segments.append(
                {
                    "start_time": s_start + cumulative_offset,
                    "end_time": s_end + cumulative_offset,
                    "text": s_text.strip(),
                    "speaker_label": None,  # Groq Whisper has no diarization
                    "source": f"groq_{model}",
                    "confidence": 0.92,
                }
            )

        chunk_duration = get_audio_duration(chunk_path)
        if i < len(chunks) - 1:
            cumulative_offset += chunk_duration - 30  # subtract overlap

    return _merge_overlapping_segments(all_segments)


def _merge_overlapping_segments(segments: list[dict]) -> list[dict]:
    if not segments:
        return []
    merged = [segments[0]]
    for seg in segments[1:]:
        prev = merged[-1]
        overlap = prev["end_time"] - seg["start_time"]
        seg_duration = seg["end_time"] - seg["start_time"]
        if overlap > 0 and seg_duration > 0 and overlap > seg_duration * 0.5:
            continue
        merged.append(seg)
    return merged


def estimate_cost(duration_seconds: float, model: str) -> float:
    minutes = duration_seconds / 60
    rate = 0.00004 if "turbo" in model else 0.00011
    return round(minutes * rate, 6)
