"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Film,
  ChevronLeft,
  ChevronRight,
  Radio,
  ListOrdered,
} from "lucide-react";
import { listSessions, type SessionMeta } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

const PAGE_SIZE = 6;
const POLL_INTERVAL = 3000;

/** Statuses that mean the job is still running and we should keep polling. */
const ACTIVE_STATUSES = new Set(["pending", "extracting", "transcribing", "summarizing", "live"]);

function StatusBadge({ session }: { session: SessionMeta }) {
  const { status, queue_position } = session;

  if (queue_position > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
        <ListOrdered className="w-3.5 h-3.5" />
        Queue #{queue_position}
      </span>
    );
  }

  switch (status) {
    case "complete":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="w-3.5 h-3.5" />
          Complete
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="w-3.5 h-3.5" />
          Failed
        </span>
      );
    case "live":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-600 font-semibold animate-pulse">
          <Radio className="w-3.5 h-3.5" />
          Live
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs text-blue-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="capitalize">{status}</span>
        </span>
      );
  }
}

export default function SessionLibrary() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await listSessions();
        if (cancelled) return;
        setSessions(data);
        setLoading(false);

        // Keep polling while any job is still in-progress or queued
        const hasActive = data.some(
          (s) => ACTIVE_STATUSES.has(s.status) || s.queue_position > 0
        );
        if (hasActive) {
          timerRef.current = setTimeout(load, POLL_INTERVAL);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Film className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p>No sessions yet. Paste a YouTube URL above to get started.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(sessions.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const pageSessions = sessions.slice(start, start + PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {pageSessions.map((s) => (
          <Link
            key={s.id}
            href={`/sessions/${s.id}`}
            className="bg-white rounded-xl border border-gray-200 hover:border-parliament-navy/40 hover:shadow-md transition-all overflow-hidden group"
          >
            {s.thumbnail_url && (
              <div className="aspect-video bg-gray-100 overflow-hidden relative">
                <img
                  src={s.thumbnail_url}
                  alt={s.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {/* Spinner overlay for in-progress jobs */}
                {ACTIVE_STATUSES.has(s.status) && s.status !== "live" && (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  </div>
                )}
                {/* Queue position overlay */}
                {s.queue_position > 0 && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="text-center text-white">
                      <ListOrdered className="w-6 h-6 mx-auto mb-1 opacity-80" />
                      <p className="text-xs font-semibold">Queue #{s.queue_position}</p>
                    </div>
                  </div>
                )}
                {/* Live badge */}
                {s.status === "live" && (
                  <div className="absolute top-2 left-2">
                    <span className="inline-flex items-center gap-1 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded animate-pulse">
                      <Radio className="w-3 h-3" /> LIVE
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="p-4">
              <h3 className="font-medium text-gray-900 text-sm line-clamp-2 mb-1">
                {s.title ?? "Untitled Session"}
              </h3>
              <p className="text-xs text-gray-500 mb-3">{s.channel}</p>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{s.duration ? formatDuration(s.duration) : "—"}</span>
                </div>
                <StatusBadge session={s} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
