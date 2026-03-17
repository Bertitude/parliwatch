import logging
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

logger = logging.getLogger(__name__)


# Parliamentary vocabulary hints for the prompt parameter
BARBADOS_PARLIAMENT_VOCAB = (
    "Parliament of Barbados, House of Assembly, Senate, Bridgetown, St. Michael, "
    "Christ Church, St. James, St. Philip, Honourable, Prime Minister, "
    "Leader of the Opposition, Minister of Finance, Attorney General, "
    "Speaker of the House, President of the Senate, constituency, Bajan"
)


def extract_youtube_captions(video_id: str, lang: str = "en") -> list[dict]:
    """
    Tier 1: Free, instant caption extraction via youtube-transcript-api.
    Returns list of {start_time, end_time, text, speaker_label, source, confidence}
    """
    ytt_api = YouTubeTranscriptApi()

    try:
        transcript_list = ytt_api.list(video_id)

        # Prefer manual captions (highest quality)
        try:
            transcript = transcript_list.find_manually_created_transcript([lang])
            source = "manual_caption"
            confidence = 0.95
        except (NoTranscriptFound, Exception):
            transcript = transcript_list.find_generated_transcript([lang])
            source = "auto_caption"
            confidence = 0.65

        fetched = transcript.fetch()

        return [
            {
                "start_time": snippet.start,
                "end_time": snippet.start + snippet.duration,
                "text": snippet.text.strip(),
                "speaker_label": None,
                "source": source,
                "confidence": confidence,
            }
            for snippet in fetched.snippets
            if snippet.text.strip()
        ]

    except (TranscriptsDisabled, NoTranscriptFound) as e:
        logger.warning(f"No captions for {video_id}: {e}")
        return []
    except Exception as e:
        logger.exception(f"Caption fetch failed for {video_id}: {e}")
        return []
