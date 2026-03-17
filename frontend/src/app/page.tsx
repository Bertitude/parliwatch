"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import URLInput from "@/components/URLInput";
import SessionLibrary from "@/components/SessionLibrary";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (url: string, tier: string, autoSummarize: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const { createSession } = await import("@/lib/api");
      const result = await createSession(url, tier, autoSummarize);
      router.push(`/sessions/${result.session_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="text-4xl font-bold text-parliament-navy mb-3">
          Parliamentary Session Transcription
        </h1>
        <p className="text-gray-600 text-lg max-w-2xl mx-auto">
          Paste any YouTube parliamentary session URL to get a synchronized,
          searchable transcript with AI-generated summaries.
        </p>
      </div>

      {/* URL Input */}
      <URLInput onSubmit={handleSubmit} loading={loading} error={error} />

      {/* Session Library */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Recent Sessions
        </h2>
        <SessionLibrary />
      </div>
    </div>
  );
}
