from openai import OpenAI
from .audio import split_audio, get_audio_duration

client = OpenAI()  # Uses OPENAI_API_KEY env var

BARBADOS_PARLIAMENT_PROMPT = (
    "Parliamentary session, Barbados House of Assembly. "
    "Honourable members, Speaker, Prime Minister, Opposition Leader, "
    "Minister of Finance, Bridgetown, St. Michael, Christ Church, "
    "St. James, St. Philip, constituency, Senate, Bajan."
)


def transcribe_with_openai(
    audio_path: str,
    model: str = "gpt-4o-mini-transcribe",
    use_diarization: bool = False,
) -> list[dict]:
    """
    Tier 2: OpenAI API transcription.
    - gpt-4o-mini-transcribe: $0.003/min, no speaker labels
    - gpt-4o-transcribe: $0.006/min, supports diarization
    """
    if use_diarization:
        model = "gpt-4o-transcribe"

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

        for seg in response.segments:
            all_segments.append(
                {
                    "start_time": seg.start + cumulative_offset,
                    "end_time": seg.end + cumulative_offset,
                    "text": seg.text.strip(),
                    "speaker_label": getattr(seg, "speaker", None),
                    "source": f"openai_{model}",
                    "confidence": 0.92,
                }
            )

        # Advance offset, accounting for overlap on all but the last chunk
        chunk_duration = get_audio_duration(chunk_path)
        if i < len(chunks) - 1:
            cumulative_offset += chunk_duration - 30

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
    rate = 0.003 if "mini" in model else 0.006
    return round(minutes * rate, 4)
