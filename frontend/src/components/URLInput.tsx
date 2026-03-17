"use client";

import { useState } from "react";
import { Link, Zap, Mic, Users, Info } from "lucide-react";
import { cn } from "@/lib/utils";

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
    color: "border-green-400 bg-green-50",
    selected: "ring-2 ring-green-500 border-green-500",
  },
  {
    id: "mini",
    label: "Enhanced",
    description: "Groq transcription (~$0.003/min)",
    icon: Mic,
    cost: "~$0.18/hr",
    color: "border-blue-400 bg-blue-50",
    selected: "ring-2 ring-blue-500 border-blue-500",
  },
  {
    id: "diarization",
    label: "Enhanced + Speakers",
    description: "Groq with speaker labels (~$0.006/min)",
    icon: Users,
    cost: "~$0.36/hr",
    color: "border-purple-400 bg-purple-50",
    selected: "ring-2 ring-purple-500 border-purple-500",
  },
];

export default function URLInput({ onSubmit, loading, error }: URLInputProps) {
  const [url, setUrl] = useState("");
  const [tier, setTier] = useState("free");
  const [autoSummarize, setAutoSummarize] = useState(false);

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
