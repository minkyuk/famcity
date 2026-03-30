"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

interface CreateSpaceModalProps {
  onClose: () => void;
}

export function CreateSpaceModal({ onClose }: CreateSpaceModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      const space = await res.json();
      showToast(`"${space.name}" created!`);
      router.push(`/spaces/${space.id}`);
      router.refresh();
      onClose();
    } catch {
      showToast("Failed to create space", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Create a Space</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Space name (e.g. Family)"
            maxLength={50}
            autoFocus
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            maxLength={200}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
          >
            {submitting ? "Creating…" : "Create Space"}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
