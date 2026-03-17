"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, CheckCircle, AlertCircle, Loader2, Film, ChevronLeft, ChevronRight } from "lucide-react";
import { listSessions, type SessionMeta } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

const PAGE_SIZE = 6;

const STATUS_ICONS = {
  pending: <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />,
  extracting: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  transcribing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  summarizing: <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />,
  complete: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <AlertCircle className="w-4 h-4 text-red-500" />,
};

export default function SessionLibrary() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
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
              <div className="aspect-video bg-gray-100 overflow-hidden">
                <img
                  src={s.thumbnail_url}
                  alt={s.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
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
                <div className="flex items-center gap-1">
                  {STATUS_ICONS[s.status as keyof typeof STATUS_ICONS] ?? null}
                  <span className="capitalize">{s.status}</span>
                </div>
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
