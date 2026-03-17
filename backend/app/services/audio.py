import os
import subprocess
import tempfile
from typing import Optional


COOKIES_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "cookies.txt")
)


def download_audio(video_id: str, output_dir: str = "") -> str:
    """Download audio-only via yt-dlp, return file path."""
    if not output_dir:
        output_dir = tempfile.gettempdir()
    output_path = os.path.join(output_dir, f"{video_id}.mp3")

    if os.path.exists(output_path):
        return output_path

    cmd = [
        "yt-dlp", "-f", "bestaudio/best",
        "--extract-audio", "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", output_path,
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    if os.path.exists(COOKIES_PATH):
        cmd[1:1] = ["--cookies", COOKIES_PATH]

    subprocess.run(cmd, check=True)  # No timeout — sessions can be several hours long
    return output_path


def get_audio_duration(filepath: str) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0", filepath,
        ],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def split_audio(filepath: str, max_size_mb: int = 20) -> list[str]:
    """Split audio into chunks safely under Groq's 25 MB API limit, with 30s overlap.

    Uses 20 MB as the target (not 24) to give headroom for:
      - 30-second overlap added to each chunk's duration
      - MP3 frame-boundary imprecision when using -acodec copy
      - HTTP multipart encoding overhead
    """
    file_size = os.path.getsize(filepath) / (1024 * 1024)
    if file_size <= max_size_mb:
        return [filepath]

    duration = get_audio_duration(filepath)
    overlap = 30

    # Calculate num_chunks so that each chunk (including overlap) stays under max_size_mb.
    # Effective chunk duration ≈ duration/n, but uploaded duration ≈ duration/n + overlap.
    # So bytes per chunk ≈ (duration/n + overlap) / duration * file_size ≤ max_size_mb
    # → n ≥ (file_size * (duration + overlap * n)) / (max_size_mb * duration)  [approx]
    # Simple conservative estimate: budget max_size_mb * 0.9 for the base content.
    num_chunks = int(file_size / (max_size_mb * 0.9)) + 1
    chunk_duration = duration / num_chunks

    chunks = []
    for i in range(num_chunks):
        start = max(0.0, i * chunk_duration - (overlap if i > 0 else 0))
        chunk_path = filepath.replace(".mp3", f"_chunk{i}.mp3")
        subprocess.run(
            [
                "ffmpeg", "-i", filepath,
                "-ss", str(start), "-t", str(chunk_duration + overlap),
                "-acodec", "copy", chunk_path, "-y",
            ],
            check=True,
            capture_output=True,
        )
        chunks.append(chunk_path)

    return chunks


def cleanup_audio(filepath: str) -> None:
    """Remove the main audio file and any chunk files."""
    base = filepath.replace(".mp3", "")
    for f in [filepath] + [f"{base}_chunk{i}.mp3" for i in range(20)]:
        try:
            if os.path.exists(f):
                os.remove(f)
        except OSError:
            pass
