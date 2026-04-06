"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/shared/Toast";

interface VideoUploaderProps {
  onSubmit: (data: { mediaUrl: string; content?: string }) => Promise<void>;
  submitting: boolean;
}

const MAX_SIZE = 100 * 1024 * 1024; // 100MB

export function VideoUploader({ onSubmit, submitting }: VideoUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const handleFile = (f: File) => {
    if (!f.type.startsWith("video/")) { showToast("Videos only", "error"); return; }
    if (f.size > MAX_SIZE) { showToast("Video must be under 100MB", "error"); return; }
    setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      // Get signed upload params from server
      const sigRes = await fetch("/api/media/sign");
      if (!sigRes.ok) throw new Error("Failed to get upload token");
      const { signature, timestamp, apiKey, cloudName } = await sigRes.json();

      // Upload directly to Cloudinary
      const fd = new FormData();
      fd.append("file", file);
      fd.append("signature", signature);
      fd.append("timestamp", String(timestamp));
      fd.append("api_key", apiKey);
      fd.append("folder", "famcity");

      const url = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status === 200) {
            const data = JSON.parse(xhr.responseText);
            resolve(data.secure_url);
          } else {
            reject(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`);
        xhr.send(fd);
      });

      await onSubmit({ mediaUrl: url, content: caption || undefined });
      setFile(null);
      setCaption("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div
        onClick={() => !file && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-4 transition-colors ${
          file ? "border-orange-300 bg-orange-50" : "border-gray-200 hover:border-orange-300 cursor-pointer"
        }`}
      >
        {file ? (
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎥</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
              <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0"
            >×</button>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-6">
            <div className="text-3xl mb-2">🎥</div>
            <p className="text-sm">Click to choose a video</p>
            <p className="text-xs mt-1">MP4, MOV, WebM · max 100MB</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
        />
      </div>

      {uploading && (
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-orange-400 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
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
        disabled={!file || submitting || uploading}
        className="bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
      >
        {uploading ? `Uploading ${progress}%…` : submitting ? "Posting…" : "Share Video"}
      </button>
    </form>
  );
}
