"use client";

import { useState, useEffect, useRef } from "react";
import { Link, Zap, Mic, Users, Info, Loader2, Radio, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { previewUrl, type VideoPreview } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

interface URLInputProps {
  onSubmit: (url: string, tier: string, autoSummarize: boolean) => void;
  loading: boolean;
  error: string | null;
}

const TIERS = [
  {
    id: "free",
    label: "Free",
    description: "YouTube auto-captions (instant, no cost)",
    icon: Zap,
    cost: "$0.00",
    selected: "ring-2 ring-green-500 border-green-500",
  },
  {
    id: "mini",
    label: "Enhanced",
    description: "Groq transcription (~$0.003/min)",
    icon: Mic,
    cost: "~$0.18/hr",
    selected: "ring-2 ring-blue-500 border-blue-500",
  },
  {
    id: "diarization",
    label: "Enhanced + Speakers",
    description: "Groq with speaker labels (~$0.006/min)",
    icon: Users,
    cost: "~$0.36/hr",
    selected: "ring-2 ring-purple-500 border-purple-500",
  },
];

const YOUTUBE_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export default function URLInput({ onSubmit, loading, error }: URLInputProps) {
  const [url, setUrl] = useState("");
  const [tier, setTier] = useState("free");
  const [autoSummarize, setAutoSummarize] = useState(false);
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce preview fetch whenever the URL changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = url.trim();

    if (!YOUTUBE_RE.test(trimmed)) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await previewUrl(trimmed);
        setPreview(data);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit(url.trim(), tier, autoSummarize);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* URL field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            YouTube URL
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Link className="w-4 h-4 text-gray-400" />
            </div>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-parliament-navy focus:border-transparent text-sm"
              disabled={loading}
              required
            />
          </div>
        </div>

        {/* Video preview card */}
        {(previewLoading || preview) && (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
            {previewLoading ? (
              <div className="flex items-center gap-3 p-4 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                Fetching video info…
              </div>
            ) : preview ? (
              <div className="flex gap-4 p-3">
                {/* Thumbnail */}
                <div className="relative flex-shrink-0 w-32 rounded-lg overflow-hidden bg-gray-200 aspect-video">
                  {preview.thumbnail ? (
                    <img
                      src={preview.thumbnail}
                      alt={preview.title}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                  {preview.is_live && (
                    <span className="absolute top-1 left-1 inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      <Radio className="w-2.5 h-2.5" /> LIVE
                    </span>
                  )}
                </div>

                {/* Meta */}
                <div className="flex-1 min-w-0 py-0.5">
                  <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug mb-1">
                    {preview.title}
                  </p>
                  <p className="text-xs text-gray-500 mb-2">{preview.channel}</p>
                  {preview.duration ? (
                    <div className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <Clock className="w-3 h-3" />
                      {formatDuration(preview.duration)}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Tier selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Transcription Tier
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TIERS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
                  className={cn(
                    "p-4 rounded-xl border-2 text-left transition-all",
                    tier === t.id ? t.selected : "border-gray-200 hover:border-gray-300"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4" />
                    <span className="font-semibold text-sm">{t.label}</span>
                  </div>
                  <p className="text-xs text-gray-500">{t.description}</p>
                  <p className="text-xs font-medium text-gray-700 mt-1">{t.cost}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Auto-summarize toggle */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="auto-summarize"
            checked={autoSummarize}
            onChange={(e) => setAutoSummarize(e.target.checked)}
            className="w-4 h-4 rounded"
            disabled={loading}
          />
          <label htmlFor="auto-summarize" className="text-sm text-gray-700 flex items-center gap-1">
            Generate AI summary after transcription
            <Info className="w-3.5 h-3.5 text-gray-400" />
          </label>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className={cn(
            "w-full py-3 px-6 rounded-lg font-semibold text-white transition-colors",
            loading || !url.trim()
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-parliament-navy hover:bg-parliament-navy/90"
          )}
        >
          {loading ? "Processing..." : "Transcribe Session"}
        </button>
      </form>
    </div>
  );
}
