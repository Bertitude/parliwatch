"use client";

import { useEffect, useRef, useState, useCallback, useMemo, use } from "react";
import type ReactPlayerType from "react-player";
import { ArrowLeft, AlertCircle, Loader2, Clock, Calendar, Tv2, Radio, StopCircle, ListOrdered, RotateCcw, Check, History } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  getSession,
  getTranscript,
  getSummary,
  triggerSummarize,
  getLiveTranscriptUrl,
  stopLiveTranscription,
  retrySession,
  getSummaryDownloadUrl,
  type SessionDetail,
  type TranscriptSegment,
  type Summary,
} from "@/lib/api";
import TranscriptPanel from "@/components/TranscriptPanel";
import SearchBar from "@/components/SearchBar";
import ExportMenu from "@/components/ExportMenu";
import SummaryPanel from "@/components/SummaryPanel";
import { formatDuration } from "@/lib/utils";

const VideoPlayer = dynamic(() => import("@/components/VideoPlayer"), { ssr: false });

const POLL_INTERVAL = 3000;

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const playerRef = useRef<ReactPlayerType | null>(null);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"transcript" | "summary">("transcript");
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [backfillProgress, setBackfillProgress] = useState({ processed: 0, total: 0 });
  const [summarizingFor, setSummarizingFor] = useState(0); // seconds spent in "summarizing" state
  const summarizingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Poll session status until complete/failed/live
  // retryCount is included so a manual retry restarts this effect cleanly
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const fetchSession = async () => {
      try {
        const s = await getSession(id);
        setSession(s);
        setLoadingSession(false);

        if (s.status === "complete") {
          // Clear any stuck-summary timer
          if (summarizingTimerRef.current) clearInterval(summarizingTimerRef.current);
          setSummarizingFor(0);
          const segs = await getTranscript(id);
          setSegments(segs);
          getSummary(id)
            .then(setSummary)
            .catch(() => null);
        } else if (s.status === "live") {
          // Load any already-transcribed segments so far
          getTranscript(id)
            .then(setSegments)
            .catch(() => null);
          // Keep polling so we notice when live → complete
          timer = setTimeout(fetchSession, POLL_INTERVAL);
        } else if (s.status === "failed") {
          if (summarizingTimerRef.current) clearInterval(summarizingTimerRef.current);
          setSummarizingFor(0);
          setError(s.error_message ?? "Processing failed");
        } else if (s.status === "summarizing") {
          // Start a counter so the UI can offer a retry if it runs too long
          if (!summarizingTimerRef.current) {
            summarizingTimerRef.current = setInterval(
              () => setSummarizingFor((n) => n + 1),
              1000,
            );
          }
          timer = setTimeout(fetchSession, POLL_INTERVAL);
        } else {
          timer = setTimeout(fetchSession, POLL_INTERVAL);
        }
      } catch {
        setError("Failed to load session");
        setLoadingSession(false);
      }
    };

    fetchSession();
    return () => {
      clearTimeout(timer);
      if (summarizingTimerRef.current) {
        clearInterval(summarizingTimerRef.current);
        summarizingTimerRef.current = null;
      }
    };
  }, [id, retryCount]);

  // Subscribe to SSE for real-time segments when session is live
  useEffect(() => {
    if (!session || session.status !== "live") return;

    const url = getLiveTranscriptUrl(id);
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "segments") {
          // Live segments — append in arrival order (they are chronological)
          setSegments((prev) => [...prev, ...msg.data]);
        } else if (msg.type === "backfill_start") {
          setBackfillStatus("running");
          setBackfillProgress({ processed: 0, total: msg.duration });
        } else if (msg.type === "backfill_segments") {
          // Backfill segments have earlier timestamps — sort so they slot in correctly
          setSegments((prev) =>
            [...prev, ...msg.data].sort((a, b) => a.start_time - b.start_time)
          );
          setBackfillProgress({ processed: msg.processed_seconds, total: msg.total_seconds });
        } else if (msg.type === "backfill_complete") {
          setBackfillStatus("complete");
          setBackfillProgress((p) => ({ ...p, processed: p.total }));
        } else if (msg.type === "backfill_error") {
          setBackfillStatus("error");
        } else if (msg.type === "done" || msg.type === "error") {
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => es.close();

    return () => es.close();
  }, [id, session?.status]);

  const handleSeek = useCallback((t: number) => {
    playerRef.current?.seekTo(t, "seconds");
  }, []);

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopLiveTranscription(id);
    } catch {
      setStopping(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retrySession(id);
      // Reset local state then bump retryCount — the polling effect depends on
      // it so incrementing re-runs the effect and resumes polling immediately.
      setError(null);
      setSegments([]);
      setSummary(null);
      setLoadingSession(true);
      setRetrying(false);
      setBackfillStatus("idle");
      setBackfillProgress({ processed: 0, total: 0 });
      setSummarizingFor(0);
      if (summarizingTimerRef.current) {
        clearInterval(summarizingTimerRef.current);
        summarizingTimerRef.current = null;
      }
      setRetryCount((c) => c + 1);
    } catch {
      setRetrying(false);
    }
  };

  const handleRequestSummary = async () => {
    setLoadingSummary(true);
    setSummaryFailed(false);
    try {
      await triggerSummarize(id);
      // Poll for summary — give up after ~90 seconds (22 attempts × 4s)
      const MAX_ATTEMPTS = 22;
      const poll = async (attempt = 0) => {
        if (attempt >= MAX_ATTEMPTS) {
          setLoadingSummary(false);
          setSummaryFailed(true);
          return;
        }
        try {
          const s = await getSummary(id);
          setSummary(s);
          setLoadingSummary(false);
        } catch {
          setTimeout(() => poll(attempt + 1), 4000);
        }
      };
      setTimeout(() => poll(0), 4000);
    } catch {
      setLoadingSummary(false);
    }
  };

  const filteredCount = useMemo(() => {
    if (!search.trim()) return segments.length;
    const q = search.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q)).length;
  }, [segments, search]);

  if (loadingSession) {
    return (
      <div className="flex items-center justify-center min-h-64 gap-2 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Loading session...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-semibold text-gray-800">Processing Failed</h2>
        <p className="text-gray-500 text-sm">{error}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-parliament-navy text-white text-sm font-semibold hover:bg-parliament-navy/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {retrying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            {retrying ? "Retrying…" : "Retry Transcription"}
          </button>
          <Link href="/" className="text-sm text-gray-500 hover:text-parliament-navy transition-colors">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const isLive = session?.status === "live";
  const isPending = session?.status !== "complete" && !isLive;

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-parliament-navy transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        All Sessions
      </Link>

      {/* Session metadata */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start gap-3 mb-3">
          <h1 className="text-xl font-bold text-gray-900 flex-1">
            {session?.title ?? "Loading..."}
          </h1>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold flex-shrink-0 animate-pulse">
              <Radio className="w-3 h-3" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-500">
          {session?.channel && (
            <div className="flex items-center gap-1.5">
              <Tv2 className="w-4 h-4" />
              {session.channel}
            </div>
          )}
          {session?.duration && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {formatDuration(session.duration)}
            </div>
          )}
          {session?.upload_date && (
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {session.upload_date}
            </div>
          )}
        </div>
      </div>

      {/* Processing state */}
      {isPending && (
        <div className={`rounded-xl p-4 flex items-center gap-3 border ${
          session?.queue_position > 0
            ? "bg-amber-50 border-amber-200"
            : "bg-blue-50 border-blue-200"
        }`}>
          {session?.queue_position > 0 ? (
            <ListOrdered className="w-5 h-5 text-amber-500 flex-shrink-0" />
          ) : (
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
          )}
          <div className="flex-1">
            {session?.queue_position > 0 ? (
              <>
                <p className="text-sm font-medium text-amber-800">
                  Queued — position #{session.queue_position}
                </p>
                <p className="text-xs text-amber-600">
                  Waiting for another job to finish. This page will update automatically.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-blue-800 capitalize">
                  {session?.status ?? "Processing"}…
                </p>
                <p className="text-xs text-blue-600">This page will update automatically.</p>
              </>
            )}
          </div>
          {/* Offer a retry button if summarization has been running for > 90 s */}
          {session?.status === "summarizing" && summarizingFor >= 90 && (
            <button
              onClick={handleRequestSummary}
              disabled={loadingSummary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {loadingSummary ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Retry Summary
            </button>
          )}
        </div>
      )}

      {/* Live banner */}
      {isLive && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <Radio className="w-5 h-5 text-red-500 flex-shrink-0 animate-pulse" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Live transcription in progress</p>
            <p className="text-xs text-red-600">
              New segments appear automatically every ~30 seconds.
            </p>
          </div>
          <button
            onClick={handleStop}
            disabled={stopping}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {stopping ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <StopCircle className="w-3.5 h-3.5" />
            )}
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
      )}

      {/* Backfill banner — shown whenever a backfill was attempted */}
      {backfillStatus !== "idle" && (
        <div className={`rounded-xl p-4 flex items-center gap-3 border ${
          backfillStatus === "running"
            ? "bg-amber-50 border-amber-200"
            : backfillStatus === "complete"
            ? "bg-green-50 border-green-200"
            : "bg-gray-50 border-gray-200"
        }`}>
          {backfillStatus === "running" ? (
            <Loader2 className="w-5 h-5 text-amber-500 animate-spin flex-shrink-0" />
          ) : backfillStatus === "complete" ? (
            <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
          ) : (
            <History className="w-5 h-5 text-gray-400 flex-shrink-0" />
          )}
          <div>
            {backfillStatus === "running" ? (
              <>
                <p className="text-sm font-medium text-amber-800">
                  Backfilling prior content
                </p>
                <p className="text-xs text-amber-600">
                  {formatDuration(backfillProgress.processed)} of{" "}
                  {formatDuration(backfillProgress.total)} processed — segments will appear above as they complete.
                </p>
              </>
            ) : backfillStatus === "complete" ? (
              <p className="text-sm font-medium text-green-800">
                Backfill complete —{" "}
                {formatDuration(backfillProgress.total)} of prior content added to transcript.
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                Backfill unavailable for this stream (DVR window may not be accessible).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main layout */}
      {(!isPending || isLive) && session && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left: video only */}
          <div className="lg:col-span-2">
            <VideoPlayer
              videoId={session.video_id}
              onTimeUpdate={setCurrentTime}
              playerRef={playerRef}
            />
          </div>

          {/* Right: tabbed transcript + summary */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 flex flex-col max-h-[80vh]">
            {/* Tab bar */}
            <div className="flex border-b border-gray-200 flex-shrink-0">
              {(["transcript", "summary"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2.5 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? "text-parliament-navy border-b-2 border-parliament-navy"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === "transcript" ? (
              <>
                {/* Transcript toolbar */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 flex-shrink-0">
                  <div className="flex-1">
                    <SearchBar
                      value={search}
                      onChange={setSearch}
                      resultCount={search ? filteredCount : undefined}
                    />
                  </div>
                  <ExportMenu sessionId={id} segments={segments} />
                </div>

                {/* Source badge */}
                {segments[0]?.source && (
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-400 flex-shrink-0">
                    Source: {segments[0].source} · {segments.length} segments
                  </div>
                )}

                {/* Scrollable transcript */}
                <div className="flex-1 overflow-y-auto">
                  <TranscriptPanel
                    segments={segments}
                    currentTime={currentTime}
                    searchQuery={search}
                    onSegmentClick={handleSeek}
                  />
                </div>
              </>
            ) : (
              <>
                {/* Summary toolbar — only shown when a summary exists */}
                {summary && (
                  <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-gray-200 flex-shrink-0">
                    <span className="text-xs text-gray-400 mr-auto">Export summary</span>
                    <a
                      href={getSummaryDownloadUrl(id, "md")}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
                    >
                      .md
                    </a>
                    <a
                      href={getSummaryDownloadUrl(id, "docx")}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
                    >
                      .docx
                    </a>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-4">
                  <SummaryPanel
                    summary={summary}
                    loading={loadingSummary}
                    failed={summaryFailed}
                    onSeek={handleSeek}
                    onRequestSummary={handleRequestSummary}
                    canRequest={!summary && !loadingSummary}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
