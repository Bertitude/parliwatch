"use client";

import { useState } from "react";
import { BookOpen, Vote, CheckSquare, User, ChevronDown, ChevronUp, Loader2, AlertCircle } from "lucide-react";
import type { Summary, Topic, Decision, Action, Speaker } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";

interface SummaryPanelProps {
  summary: Summary | null;
  loading: boolean;
  failed?: boolean;
  onSeek: (t: number) => void;
  onRequestSummary: () => void;
  canRequest: boolean;
}

export default function SummaryPanel({
  summary,
  loading,
  failed = false,
  onSeek,
  onRequestSummary,
  canRequest,
}: SummaryPanelProps) {
  const [openTopics, setOpenTopics] = useState<Set<number>>(new Set([0]));

  const toggleTopic = (i: number) => {
    setOpenTopics((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Generating summary...</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-4 text-gray-400">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-sm text-red-600">Summary generation failed.</p>
        <button
          onClick={onRequestSummary}
          className="px-4 py-2 bg-parliament-navy text-white text-sm rounded-lg hover:bg-parliament-navy/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-4 text-gray-400">
        <BookOpen className="w-10 h-10 opacity-50" />
        <p className="text-sm">No summary generated yet.</p>
        {canRequest && (
          <button
            onClick={onRequestSummary}
            className="px-4 py-2 bg-parliament-navy text-white text-sm rounded-lg hover:bg-parliament-navy/90 transition-colors"
          >
            Generate AI Summary
          </button>
        )}
      </div>
    );
  }

  const outcomeColor = (o: string) =>
    o === "passed"
      ? "text-green-700 bg-green-100"
      : o === "defeated"
      ? "text-red-700 bg-red-100"
      : "text-yellow-700 bg-yellow-100";

  return (
    <div className="space-y-6 text-sm">
      {/* Executive Summary */}
      <section>
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-parliament-navy" />
          Executive Summary
        </h3>
        <p className="text-gray-700 leading-relaxed">{summary.executive_summary}</p>
      </section>

      {/* Topics */}
      {summary.topics?.length > 0 && (
        <section>
          <h3 className="font-semibold text-gray-900 mb-2">Topics Discussed</h3>
          <div className="space-y-2">
            {summary.topics.map((topic: Topic, i: number) => (
              <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleTopic(i)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <span className="font-medium text-gray-800">{topic.title}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeek(topic.start_time);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          onSeek(topic.start_time);
                        }
                      }}
                      className="ml-2 text-xs text-parliament-navy hover:underline cursor-pointer"
                    >
                      {formatTimestamp(topic.start_time)}
                    </span>
                  </div>
                  {openTopics.has(i) ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>
                {openTopics.has(i) && (
                  <div className="px-4 pb-3 text-gray-600 text-xs leading-relaxed border-t border-gray-100 pt-3">
                    {topic.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Decisions */}
      {summary.decisions?.length > 0 && (
        <section>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <Vote className="w-4 h-4 text-parliament-navy" />
            Decisions & Votes
          </h3>
          <div className="space-y-2">
            {summary.decisions.map((d: Decision, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${outcomeColor(d.outcome)}`}
                >
                  {d.outcome}
                </span>
                <div className="flex-1">
                  <p className="text-gray-700">{d.description}</p>
                  <button
                    onClick={() => onSeek(d.timestamp)}
                    className="text-xs text-parliament-navy hover:underline mt-1"
                  >
                    {formatTimestamp(d.timestamp)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Actions */}
      {summary.actions?.length > 0 && (
        <section>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-parliament-navy" />
            Action Items
          </h3>
          <ul className="space-y-2">
            {summary.actions.map((a: Action, i: number) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <span className="mt-0.5 w-4 h-4 rounded-full bg-parliament-navy/10 flex-shrink-0 flex items-center justify-center text-xs text-parliament-navy font-bold">
                  {i + 1}
                </span>
                <div>
                  {a.description}
                  {a.responsible && (
                    <span className="ml-1 text-gray-500 text-xs">— {a.responsible}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Speakers */}
      {summary.speakers?.length > 0 && (
        <section>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <User className="w-4 h-4 text-parliament-navy" />
            Speakers
          </h3>
          <div className="space-y-3">
            {summary.speakers.map((sp: Speaker, i: number) => (
              <div key={i} className="p-3 border border-gray-200 rounded-lg">
                <div className="font-medium text-gray-800">{sp.name}</div>
                {sp.role && <div className="text-xs text-gray-500 mb-2">{sp.role}</div>}
                <ul className="space-y-1">
                  {sp.key_positions?.map((pos: string, j: number) => (
                    <li key={j} className="text-xs text-gray-600">
                      • {pos}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
