"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { YouTubeInput } from "./YouTubeInput";
import { ImageUploader } from "./ImageUploader";
import { AudioRecorder } from "./AudioRecorder";
import { useToast } from "@/components/shared/Toast";

type PostType = "TEXT" | "YOUTUBE" | "IMAGE" | "AUDIO";

const TYPES: { type: PostType; icon: string; label: string }[] = [
  { type: "TEXT", icon: "📝", label: "Text" },
  { type: "YOUTUBE", icon: "🎬", label: "YouTube" },
  { type: "IMAGE", icon: "🖼", label: "Photo" },
  { type: "AUDIO", icon: "🎙", label: "Audio" },
];

export function ComposeBar() {
  const [activeType, setActiveType] = useState<PostType>("TEXT");
  const [textContent, setTextContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  const createPost = async (data: {
    type: PostType;
    mediaUrl?: string;
    content?: string;
  }) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      showToast("Posted!");
      router.push("/");
      router.refresh();
    } catch {
      showToast("Failed to post", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
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
        <YouTubeInput
          submitting={submitting}
          onSubmit={(data) => createPost({ type: "YOUTUBE", ...data })}
        />
      )}

      {activeType === "IMAGE" && (
        <ImageUploader
          submitting={submitting}
          onSubmit={(data) => createPost({ type: "IMAGE", ...data })}
        />
      )}

      {activeType === "AUDIO" && (
        <AudioRecorder
          submitting={submitting}
          onSubmit={(data) => createPost({ type: "AUDIO", ...data })}
        />
      )}
    </div>
  );
}
