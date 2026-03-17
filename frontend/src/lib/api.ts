const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface SessionMeta {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail_url: string;
  status: string;
  transcription_tier: string;
  created_at: string;
}

export interface SessionDetail {
  id: string;
  youtube_url: string;
  video_id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail_url: string;
  upload_date: string;
  is_live: boolean;
  status: string;
  transcript_source: string;
  transcription_tier: string;
  error_message: string | null;
  created_at: string;
}

export interface TranscriptSegment {
  id: number;
  start_time: number;
  end_time: number;
  text: string;
  speaker_label: string | null;
  confidence: number | null;
  source: string | null;
  is_edited: boolean;
}

export interface Summary {
  executive_summary: string;
  topics: Topic[];
  decisions: Decision[];
  actions: Action[];
  speakers: Speaker[];
  created_at: string;
}

export interface Topic {
  title: string;
  start_time: number;
  end_time: number;
  summary: string;
  speakers: string[];
}

export interface Decision {
  description: string;
  outcome: "passed" | "defeated" | "deferred" | "withdrawn";
  timestamp: number;
}

export interface Action {
  description: string;
  responsible: string;
  timestamp: number;
}

export interface Speaker {
  name: string;
  role: string;
  key_positions: string[];
}

export async function createSession(
  youtubeUrl: string,
  tier: string,
  autoSummarize: boolean
): Promise<{ session_id: string; metadata: Record<string, unknown>; status: string }> {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      youtube_url: youtubeUrl,
      transcription_tier: tier,
      auto_summarize: autoSummarize,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Failed to create session");
  }
  return res.json();
}

export async function listSessions(): Promise<SessionMeta[]> {
  const res = await fetch(`${API_BASE}/api/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function getSession(id: string): Promise<SessionDetail> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`);
  if (!res.ok) throw new Error("Session not found");
  return res.json();
}

export async function getTranscript(id: string): Promise<TranscriptSegment[]> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/transcript`);
  if (!res.ok) throw new Error("Failed to fetch transcript");
  return res.json();
}

export async function getSummary(id: string): Promise<Summary> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/summary`);
  if (!res.ok) throw new Error("Summary not available");
  return res.json();
}

export async function triggerSummarize(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/summarize`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to trigger summarization");
}

export function getTranscriptDownloadUrl(id: string, format: string): string {
  return `${API_BASE}/api/sessions/${id}/transcript?format=${format}`;
}

export function getLiveTranscriptUrl(id: string): string {
  return `${API_BASE}/api/sessions/${id}/live-transcript`;
}

export function getSummaryDownloadUrl(id: string, format: "md" | "docx"): string {
  return `${API_BASE}/api/sessions/${id}/summary/download?format=${format}`;
}

export function getBundleDownloadUrl(id: string): string {
  return `${API_BASE}/api/sessions/${id}/export/bundle`;
}

export async function stopLiveTranscription(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/stop`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop live transcription");
}
