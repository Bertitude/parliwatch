"use client";

import { useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type ReactPlayerType from "react-player";

// SSR-safe dynamic import
const ReactPlayer = dynamic(() => import("react-player/youtube"), { ssr: false });

interface VideoPlayerProps {
  videoId: string;
  onTimeUpdate: (seconds: number) => void;
  playerRef: React.MutableRefObject<ReactPlayerType | null>;
}

export default function VideoPlayer({ videoId, onTimeUpdate, playerRef }: VideoPlayerProps) {
  const handleProgress = useCallback(
    ({ playedSeconds }: { playedSeconds: number }) => {
      onTimeUpdate(playedSeconds);
    },
    [onTimeUpdate]
  );

  return (
    <div className="bg-black rounded-xl overflow-hidden shadow-lg">
      <div className="relative aspect-video">
        <ReactPlayer
          ref={playerRef as React.MutableRefObject<ReactPlayerType>}
          url={`https://www.youtube.com/watch?v=${videoId}`}
          width="100%"
          height="100%"
          controls
          onProgress={handleProgress}
          progressInterval={250}
          config={{
            playerVars: {
              modestbranding: 1,
              rel: 0,
            },
          }}
        />
      </div>
    </div>
  );
}
