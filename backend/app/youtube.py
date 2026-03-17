import re
import json
import subprocess
from typing import Optional


YOUTUBE_PATTERNS = [
    r'(?:https?://)?(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})',
    r'(?:https?://)?(?:www\.)?youtube\.com/live/([a-zA-Z0-9_-]{11})',
    r'(?:https?://)?youtu\.be/([a-zA-Z0-9_-]{11})',
    r'(?:https?://)?(?:www\.)?youtube\.com/embed/([a-zA-Z0-9_-]{11})',
]


def extract_video_id(url: str) -> Optional[str]:
    for pattern in YOUTUBE_PATTERNS:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def get_video_metadata(video_id: str) -> dict:
    url = f"https://www.youtube.com/watch?v={video_id}"
    result = subprocess.run(
        ["yt-dlp", "--dump-json", "--no-download", "--no-check-formats", url],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise ValueError(f"Failed to fetch metadata: {result.stderr}")

    data = json.loads(result.stdout)
    return {
        "title": data.get("title"),
        "channel": data.get("channel"),
        "duration": data.get("duration"),
        "thumbnail": data.get("thumbnail"),
        "upload_date": data.get("upload_date"),
        "is_live": data.get("is_live", False),
        "was_live": data.get("was_live", False),
        "release_timestamp": data.get("release_timestamp"),  # Unix epoch stream started; None for VODs
        "description": (data.get("description") or "")[:500],
    }
