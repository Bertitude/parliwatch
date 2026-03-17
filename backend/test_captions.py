from youtube_transcript_api import YouTubeTranscriptApi
import youtube_transcript_api

import importlib.metadata
print("Version:", importlib.metadata.version("youtube-transcript-api"))

video_id = "NtRPLCso0Sw"
api = YouTubeTranscriptApi()

try:
    tl = api.list(video_id)
    print("Available transcripts:")
    for t in tl:
        print(f"  - {t.language} ({t.language_code}) generated={t.is_generated}")

    transcript = tl.find_generated_transcript(["en"])
    print("\nFetching transcript...")
    fetched = transcript.fetch()
    print(f"Got {len(fetched.snippets)} snippets")
    print("First snippet:", fetched.snippets[0])
except Exception as e:
    import traceback
    print(f"ERROR: {type(e).__name__}: {e}")
    traceback.print_exc()
