"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/shared/Toast";

interface PDFUploaderProps {
  onSubmit: (data: { mediaUrl: string; content?: string; fileType: "PDF" | "VIDEO" }) => Promise<void>;
  submitting: boolean;
}

export function PDFUploader({ onSubmit, submitting }: PDFUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const isWebm = file?.type === "video/webm";

  const handleFile = (f: File) => {
    if (f.type === "video/webm") {
      if (f.size > 50 * 1024 * 1024) { showToast("Video must be under 50MB", "error"); return; }
    } else if (f.type === "application/pdf") {
      if (f.size > 10 * 1024 * 1024) { showToast("PDF must be under 10MB", "error"); return; }
    } else {
      showToast("PDFs and .webm videos only", "error"); return;
    }
    setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Upload failed");
      }
      const { url } = await res.json();
      // Store filename in content if no caption provided
      await onSubmit({ mediaUrl: url, content: caption || file.name, fileType: file.type === "video/webm" ? "VIDEO" : "PDF" });
      setFile(null);
      setCaption("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
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
            <span className="text-3xl">{isWebm ? "🎬" : "📄"}</span>
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
            <div className="text-3xl mb-2">📄</div>
            <p className="text-sm">Click to choose a PDF or .webm video</p>
            <p className="text-xs mt-1">PDF max 10MB · Video max 50MB</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,video/webm"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
        />
      </div>

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
        {uploading ? "Uploading…" : submitting ? "Posting…" : isWebm ? "Share Video" : "Share PDF"}
      </button>
    </form>
  );
}
