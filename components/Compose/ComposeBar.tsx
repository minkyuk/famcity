"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { YouTubeInput } from "./YouTubeInput";
import { ImageUploader } from "./ImageUploader";
import { AudioRecorder } from "./AudioRecorder";
import { VideoUploader } from "./VideoUploader";
import { PDFUploader } from "./PDFUploader";
import { useToast } from "@/components/shared/Toast";

type PostType = "TEXT" | "YOUTUBE" | "IMAGE" | "AUDIO" | "VIDEO" | "PDF";

const TYPES: { type: PostType; icon: string; label: string }[] = [
  { type: "TEXT", icon: "📝", label: "Text" },
  { type: "YOUTUBE", icon: "🎬", label: "YouTube" },
  { type: "IMAGE", icon: "🖼", label: "Photo" },
  { type: "VIDEO", icon: "🎥", label: "Video" },
  { type: "AUDIO", icon: "🎙", label: "Audio" },
  { type: "PDF", icon: "📄", label: "PDF" },
];

interface Space { id: string; name: string; }

export function ComposeBar() {
  const [activeType, setActiveType] = useState<PostType>("TEXT");
  const [textContent, setTextContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize directly from URL so the dropdown shows the right space immediately
  const [spaceId, setSpaceId] = useState<string>(() => searchParams.get("spaceId") ?? "global");

  useEffect(() => {
    fetch("/api/spaces")
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        setSpaces(data);
      })
      .catch(() => {});
  }, []);

  const createPost = async (data: {
    type: PostType;
    mediaUrl?: string;
    mediaUrls?: string[];
    content?: string;
  }) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, spaceId: spaceId === "global" ? undefined : spaceId || undefined }),
      });
      if (!res.ok) throw new Error();
      showToast("Posted!");
      router.push(spaceId && spaceId !== "global" ? `/spaces/${spaceId}` : "/");
      router.refresh();
    } catch {
      showToast("Failed to post", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Space selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Post to</span>
        <select
          value={spaceId}
          onChange={(e) => setSpaceId(e.target.value)}
          className="text-sm font-semibold text-gray-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300"
        >
          <option value="global">🌍 Everyone (global)</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>👥 {s.name}</option>
          ))}
        </select>
      </div>

      {/* Type selector */}
      <div className="flex gap-2">
        {TYPES.map(({ type, icon, label }) => (
          <button
            key={type}
            onClick={() => setActiveType(type)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
              activeType === type
                ? "bg-accent text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            <span>{icon}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {activeType === "TEXT" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!textContent.trim()) return;
            await createPost({ type: "TEXT", content: textContent.trim() });
            setTextContent("");
          }}
          className="flex flex-col gap-3"
        >
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="What's on your mind?"
            rows={4}
            className="border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <button
            type="submit"
            disabled={!textContent.trim() || submitting}
            className="bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
          >
            {submitting ? "Posting…" : "Share"}
          </button>
        </form>
      )}

      {activeType === "YOUTUBE" && (
        <YouTubeInput submitting={submitting} onSubmit={(data) => createPost({ type: "YOUTUBE", ...data })} />
      )}
      {activeType === "IMAGE" && (
        <ImageUploader
          submitting={submitting}
          onSubmit={(data) => createPost({ type: "IMAGE", mediaUrls: data.mediaUrls, content: data.content })}
        />
      )}
      {activeType === "VIDEO" && (
        <VideoUploader submitting={submitting} onSubmit={(data) => createPost({ type: "VIDEO", ...data })} />
      )}
      {activeType === "AUDIO" && (
        <AudioRecorder submitting={submitting} onSubmit={(data) => createPost({ type: "AUDIO", ...data })} />
      )}
      {activeType === "PDF" && (
        <PDFUploader submitting={submitting} onSubmit={(data) => createPost({ type: "PDF", ...data })} />
      )}
    </div>
  );
}
