"use client";

import { useEffect, useRef, useMemo } from "react";
import { formatTimestamp } from "@/lib/utils";
import type { TranscriptSegment } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  currentTime: number;
  searchQuery: string;
  onSegmentClick: (startTime: number) => void;
}

export default function TranscriptPanel({
  segments,
  currentTime,
  searchQuery,
  onSegmentClick,
}: TranscriptPanelProps) {
  const activeIndexRef = useRef(-1);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const q = searchQuery.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, searchQuery]);

  const activeIndex = useMemo(
    () => filtered.findIndex((s) => currentTime >= s.start_time && currentTime < s.end_time),
    [filtered, currentTime]
  );

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeIndex !== -1 && activeIndex !== activeIndexRef.current) {
      activeIndexRef.current = activeIndex;
      document.getElementById(`seg-${activeIndex}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeIndex]);

  // Highlight search terms
  const highlight = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return parts.map((p, i) =>
      regex.test(p) ? (
        <mark key={i} className="bg-yellow-200 rounded-sm px-0.5">
          {p}
        </mark>
      ) : (
        p
      )
    );
  };

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Transcript not yet available.
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        No segments match your search.
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {filtered.map((seg, i) => (
        <div
          key={`${seg.id}-${i}`}
          id={`seg-${i}`}
          onClick={() => onSegmentClick(seg.start_time)}
          className={cn(
            "flex gap-3 px-4 py-3 cursor-pointer transition-colors",
            i === activeIndex
              ? "bg-parliament-gold/15 border-l-4 border-parliament-gold"
              : "hover:bg-gray-50 border-l-4 border-transparent"
          )}
        >
          <button
            className="flex-shrink-0 text-xs font-mono text-parliament-navy hover:underline pt-0.5 w-12 text-right"
            onClick={(e) => {
              e.stopPropagation();
              onSegmentClick(seg.start_time);
            }}
          >
            {formatTimestamp(seg.start_time)}
          </button>
          <div className="flex-1 min-w-0">
            {seg.speaker_label && (
              <span className="text-xs font-semibold text-purple-700 uppercase tracking-wide mr-2">
                {seg.speaker_label}:
              </span>
            )}
            <span className="text-sm text-gray-800 leading-relaxed">
              {highlight(seg.text, searchQuery)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
