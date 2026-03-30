"use client";

import { useRef, useState, useEffect } from "react";
import { useToast } from "@/components/shared/Toast";

interface AudioRecorderProps {
  onSubmit: (data: { mediaUrl: string; content?: string }) => Promise<void>;
  submitting: boolean;
}

type RecordState = "idle" | "recording" | "recorded";

export function AudioRecorder({ onSubmit, submitting }: AudioRecorderProps) {
  const [state, setState] = useState<RecordState>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "audio/webm" });
        setBlob(b);
        setPreviewUrl(URL.createObjectURL(b));
        setState("recorded");
        stream.getTracks().forEach((t) => t.stop());
      };

      mr.start();
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      showToast("Mic access denied — please allow microphone permission", "error");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const discard = () => {
    setBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setState("idle");
    setSeconds(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blob) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, "recording.webm");
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      await onSubmit({ mediaUrl: url, content: caption || undefined });
      discard();
      setCaption("");
    } catch {
      showToast("Upload failed — try again", "error");
    } finally {
      setUploading(false);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {state === "idle" && (
        <button
          type="button"
          onClick={startRecording}
          className="flex flex-col items-center gap-2 py-10 border-2 border-dashed border-gray-200 rounded-xl hover:border-orange-300 transition-colors"
        >
          <span className="text-4xl">🎙</span>
          <span className="text-sm text-gray-500">Tap to start recording</span>
        </button>
      )}

      {state === "recording" && (
        <div className="flex flex-col items-center gap-4 py-8 bg-red-50 rounded-xl border border-red-100">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-semibold text-red-600">Recording…</span>
          </div>
          <p className="text-2xl font-mono text-red-500">{fmt(seconds)}</p>
          <button
            type="button"
            onClick={stopRecording}
            className="bg-red-500 text-white rounded-xl px-6 py-2.5 text-sm font-semibold hover:bg-red-600 transition-colors"
          >
            Stop Recording
          </button>
        </div>
      )}

      {state === "recorded" && previewUrl && (
        <div className="flex flex-col gap-3 bg-purple-50 rounded-xl p-4 border border-purple-100">
          <p className="text-sm font-semibold text-purple-700">Preview</p>
          <audio src={previewUrl} controls className="w-full" />
          <button
            type="button"
            onClick={discard}
            className="text-sm text-gray-400 hover:text-gray-600 self-start"
          >
            Re-record
          </button>
        </div>
      )}

      {state === "recorded" && (
        <>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption… (optional)"
            rows={2}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <button
            type="submit"
            disabled={submitting || uploading}
            className="bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
          >
            {uploading ? "Uploading…" : submitting ? "Posting…" : "Share Audio"}
          </button>
        </>
      )}
    </form>
  );
}
