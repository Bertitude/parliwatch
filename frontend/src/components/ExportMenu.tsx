"use client";

import { useState, useRef, useEffect } from "react";
import { Download, ChevronDown } from "lucide-react";
import { getTranscriptDownloadUrl, getBundleDownloadUrl } from "@/lib/api";
import type { TranscriptSegment } from "@/lib/api";
import { toSRT } from "@/lib/utils";

interface ExportMenuProps {
  sessionId: string;
  segments: TranscriptSegment[];
}

export default function ExportMenu({ sessionId, segments }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const downloadClientSide = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
  };

  const options = [
    {
      label: "Markdown (with timecodes)",
      action: () => window.open(getTranscriptDownloadUrl(sessionId, "md"), "_blank"),
    },
    {
      label: "SRT Subtitles",
      action: () => window.open(getTranscriptDownloadUrl(sessionId, "srt"), "_blank"),
    },
    {
      label: "WebVTT",
      action: () => window.open(getTranscriptDownloadUrl(sessionId, "vtt"), "_blank"),
    },
    {
      label: "Plain Text",
      action: () => window.open(getTranscriptDownloadUrl(sessionId, "txt"), "_blank"),
    },
    {
      label: "JSON",
      action: () =>
        downloadClientSide(
          JSON.stringify(segments, null, 2),
          `transcript-${sessionId}.json`,
          "application/json"
        ),
    },
    { label: "divider", action: () => {} },
    {
      label: "⬇ Download All (ZIP)",
      action: () => window.open(getBundleDownloadUrl(sessionId), "_blank"),
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Download className="w-4 h-4" />
        Export
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
          {options.map((opt) =>
            opt.label === "divider" ? (
              <hr key="divider" className="my-1 border-gray-100" />
            ) : (
              <button
                key={opt.label}
                onClick={() => {
                  opt.action();
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  opt.label.startsWith("⬇")
                    ? "text-parliament-navy font-medium hover:bg-blue-50"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {opt.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
