"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useToast } from "@/components/shared/Toast";

interface ImageUploaderProps {
  onSubmit: (data: { mediaUrl: string; content?: string }) => Promise<void>;
  submitting: boolean;
}

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function ImageUploader({ onSubmit, submitting }: ImageUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      showToast("Please select an image file", "error");
      return;
    }
    if (f.size > MAX_SIZE) {
      showToast("Image must be under 10MB", "error");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      await onSubmit({ mediaUrl: url, content: caption || undefined });
      setFile(null);
      setPreview(null);
      setCaption("");
    } catch {
      showToast("Upload failed — try again", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !file && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          dragOver ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-300"
        } ${file ? "cursor-default" : ""}`}
      >
        {preview ? (
          <div className="relative">
            <Image src={preview} alt="Preview" width={600} height={400} className="rounded-lg max-h-64 object-cover mx-auto" unoptimized />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }}
              className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="text-gray-400">
            <div className="text-3xl mb-2">🖼</div>
            <p className="text-sm">Drag and drop or click to choose an image</p>
            <p className="text-xs mt-1">JPG, PNG, GIF, WebP — max 10MB</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
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
        {uploading ? "Uploading…" : submitting ? "Posting…" : "Share Photo"}
      </button>
    </form>
  );
}
