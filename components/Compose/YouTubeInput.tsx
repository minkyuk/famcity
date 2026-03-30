"use client";

import { useState, useEffect } from "react";
import { YoutubeEmbed } from "@/components/Feed/YoutubeEmbed";
import { extractYouTubeId } from "@/lib/youtube";

interface YouTubeInputProps {
  onSubmit: (data: { mediaUrl: string; content?: string }) => Promise<void>;
  submitting: boolean;
}

export function YouTubeInput({ onSubmit, submitting }: YouTubeInputProps) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [debouncedUrl, setDebouncedUrl] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(url), 500);
    return () => clearTimeout(t);
  }, [url]);

  const videoId = extractYouTubeId(debouncedUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoId) return;
    await onSubmit({ mediaUrl: url, content: caption || undefined });
    setUrl("");
    setCaption("");
    setDebouncedUrl("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste YouTube URL…"
        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
      />
      {videoId && (
        <div className="rounded-xl overflow-hidden">
          <YoutubeEmbed url={debouncedUrl} />
        </div>
      )}
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Add a caption… (optional)"
        rows={2}
        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200"
      />
      <button
        type="submit"
        disabled={!videoId || submitting}
        className="bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
      >
        {submitting ? "Posting…" : "Share Video"}
      </button>
    </form>
  );
}
