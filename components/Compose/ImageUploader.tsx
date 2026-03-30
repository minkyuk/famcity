"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useToast } from "@/components/shared/Toast";

interface ImageUploaderProps {
  onSubmit: (data: { mediaUrls: string[]; content?: string }) => Promise<void>;
  submitting: boolean;
}

const MAX_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

interface Preview { file: File; objectUrl: string; }

export function ImageUploader({ onSubmit, submitting }: ImageUploaderProps) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const remaining = MAX_FILES - previews.length;
    if (remaining <= 0) { showToast(`Max ${MAX_FILES} photos`, "error"); return; }

    const valid: Preview[] = [];
    for (const f of arr.slice(0, remaining)) {
      if (!f.type.startsWith("image/")) { showToast("Images only", "error"); continue; }
      if (f.size > MAX_SIZE) { showToast(`${f.name} is over 10MB`, "error"); continue; }
      valid.push({ file: f, objectUrl: URL.createObjectURL(f) });
    }
    setPreviews((prev) => [...prev, ...valid]);
  };

  const remove = (idx: number) => {
    URL.revokeObjectURL(previews[idx].objectUrl);
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (previews.length === 0) return;

    setUploading(true);
    try {
      const urls = await Promise.all(
        previews.map(async ({ file }) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/media/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error("Upload failed");
          const { url } = await res.json();
          return url as string;
        })
      );
      await onSubmit({ mediaUrls: urls, content: caption || undefined });
      previews.forEach((p) => URL.revokeObjectURL(p.objectUrl));
      setPreviews([]);
      setCaption("");
    } catch {
      showToast("One or more uploads failed", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => previews.length < MAX_FILES && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-4 transition-colors ${
          dragOver ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-300"
        } ${previews.length >= MAX_FILES ? "cursor-default opacity-50" : "cursor-pointer"}`}
      >
        {previews.length === 0 ? (
          <div className="text-center text-gray-400 py-6">
            <div className="text-3xl mb-2">🖼</div>
            <p className="text-sm">Drag photos here or click to browse</p>
            <p className="text-xs mt-1">Up to {MAX_FILES} photos · JPG, PNG, GIF · max 10MB each</p>
          </div>
        ) : (
          <div className={`grid gap-2 ${previews.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
            {previews.map((p, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                <Image src={p.objectUrl} alt="" fill className="object-cover" unoptimized />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(i); }}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >✕</button>
              </div>
            ))}
            {previews.length < MAX_FILES && (
              <div className="aspect-square rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 text-2xl hover:border-orange-300 transition-colors">
                +
              </div>
            )}
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {previews.length > 0 && (
        <p className="text-xs text-gray-400">{previews.length}/{MAX_FILES} photos selected</p>
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
        disabled={previews.length === 0 || submitting || uploading}
        className="bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
      >
        {uploading ? `Uploading ${previews.length} photo${previews.length > 1 ? "s" : ""}…` : submitting ? "Posting…" : `Share ${previews.length > 1 ? `${previews.length} Photos` : "Photo"}`}
      </button>
    </form>
  );
}
