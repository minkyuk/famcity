"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useToast } from "@/components/shared/Toast";

interface ImageUploaderProps {
  onSubmit: (data: { mediaUrls: string[]; content?: string }) => Promise<void>;
  submitting: boolean;
}

const MAX_RAW_SIZE = 20 * 1024 * 1024; // 20MB hard reject — too large even to compress
const TARGET_SIZE  =  3.5 * 1024 * 1024; // compress down to ~3.5MB to stay under Vercel's 4.5MB limit
const MAX_FILES = 10;

interface Preview { file: File; objectUrl: string; }

// Compress an image using Canvas. Tries JPEG quality 0.85 → 0.5 and halves
// dimensions if still too large. Returns the original file if it's already small.
async function compressImage(file: File): Promise<File> {
  if (file.size <= TARGET_SIZE) return file;

  return new Promise((resolve) => {
    const img = document.createElement("img");
    const blobUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(blobUrl);

      const canvas = document.createElement("canvas");
      let { width, height } = img;

      // Scale down if dimensions are very large (max 2048px on longest side)
      const MAX_DIM = 2048;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }

      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);

      const attempt = (quality: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size <= TARGET_SIZE || quality <= 0.4) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
            } else {
              attempt(Math.round((quality - 0.1) * 10) / 10);
            }
          },
          "image/jpeg",
          quality
        );
      };

      attempt(0.85);
    };

    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };
    img.src = blobUrl;
  });
}

export function ImageUploader({ onSubmit, submitting }: ImageUploaderProps) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [statusLabel, setStatusLabel] = useState("");
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
      if (f.size > MAX_RAW_SIZE) { showToast(`${f.name} is over 20MB`, "error"); continue; }
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
    setStatusLabel("");
    try {
      const urls: string[] = [];
      for (let i = 0; i < previews.length; i++) {
        const { file } = previews[i];

        // Compress if needed
        let toUpload = file;
        if (file.size > TARGET_SIZE) {
          setStatusLabel(`Compressing ${i + 1}/${previews.length}…`);
          toUpload = await compressImage(file);
        }

        setStatusLabel(`Uploading ${i + 1}/${previews.length}…`);
        const fd = new FormData();
        fd.append("file", toUpload);
        const res = await fetch("/api/media/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? "Upload failed");
        }
        const { url } = await res.json();
        urls.push(url as string);
      }

      await onSubmit({ mediaUrls: urls, content: caption || undefined });
      previews.forEach((p) => URL.revokeObjectURL(p.objectUrl));
      setPreviews([]);
      setCaption("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
      setStatusLabel("");
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
            <p className="text-xs mt-1">Up to {MAX_FILES} photos · JPG, PNG, GIF · max 20MB each (auto-compressed)</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {previews.map((p, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden group shrink-0">
                <Image src={p.objectUrl} alt="" fill className="object-cover" unoptimized sizes="80px" />
                <button
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); remove(i); }}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >✕</button>
              </div>
            ))}
            {previews.length < MAX_FILES && (
              <div className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 text-2xl hover:border-orange-300 transition-colors shrink-0">
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
        {uploading
          ? statusLabel || "Working…"
          : submitting
          ? "Posting…"
          : `Share ${previews.length > 1 ? `${previews.length} Photos` : "Photo"}`}
      </button>
    </form>
  );
}
