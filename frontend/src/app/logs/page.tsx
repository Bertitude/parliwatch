"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, RefreshCw, Trash2, Server, Monitor } from "lucide-react";
import { getLogs } from "@/lib/api";

type Service = "backend" | "frontend";

function classifyLine(line: string): "error" | "warning" | "info" | "dim" {
  const l = line.toLowerCase();
  if (l.includes(" error") || l.includes("[error]") || l.includes("traceback") || l.includes("exception")) return "error";
  if (l.includes("warning") || l.includes("[warn]")) return "warning";
  if (l.includes(" info") || l.includes("[info]")) return "info";
  return "dim";
}

const LINE_COLORS: Record<ReturnType<typeof classifyLine>, string> = {
  error:   "text-red-400",
  warning: "text-amber-400",
  info:    "text-green-400",
  dim:     "text-gray-400",
};

export default function LogsPage() {
  const [service, setService] = useState<Service>("backend");
  const [lines, setLines]     = useState<string[]>([]);
  const [note, setNote]       = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const timerRef   = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = useCallback(async (svc: Service) => {
    try {
      const data = await getLogs(svc, 300);
      setLines(data.lines);
      setNote(data.note ?? null);
    } catch {
      setLines(["[ParliWatch] Could not reach backend — is it running?"]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 3 s
  useEffect(() => {
    setLoading(true);
    setLines([]);
    fetchLogs(service);
    timerRef.current = setInterval(() => fetchLogs(service), 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [service, fetchLogs]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, autoScroll]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Server Logs</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="w-3.5 h-3.5 rounded"
            />
            Auto-scroll
          </label>
          <button
            onClick={() => fetchLogs(service)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Service tabs */}
      <div className="flex gap-2">
        {(["backend", "frontend"] as Service[]).map((svc) => (
          <button
            key={svc}
            onClick={() => setService(svc)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              service === svc
                ? "bg-parliament-navy text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {svc === "backend" ? <Server className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            {svc.charAt(0).toUpperCase() + svc.slice(1)}
          </button>
        ))}
      </div>

      {/* Log pane */}
      <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
          <span className="text-xs text-gray-500 font-mono">
            logs/{service}.log — {lines.length} lines
          </span>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-400">● INFO</span>
            <span className="text-amber-400">● WARN</span>
            <span className="text-red-400">● ERROR</span>
          </div>
        </div>

        {/* Lines */}
        <div className="h-[65vh] overflow-y-auto p-4 font-mono text-xs leading-relaxed">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading...
            </div>
          ) : note ? (
            <p className="text-amber-400">{note}</p>
          ) : lines.length === 0 ? (
            <p className="text-gray-600">No log output yet.</p>
          ) : (
            lines.map((line, i) => (
              <div key={i} className={`${LINE_COLORS[classifyLine(line)]} whitespace-pre-wrap break-all`}>
                {line || "\u00a0"}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Logs are written to <code className="bg-gray-100 px-1 rounded">logs/backend.log</code> and{" "}
        <code className="bg-gray-100 px-1 rounded">logs/frontend.log</code> in the project root.
        Refreshes every 3 seconds automatically.
      </p>
    </div>
  );
}
