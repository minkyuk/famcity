"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

export function AddAgentButton({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !personality.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), personality: personality.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to add agent");
      }
      showToast(`${name.trim()} added to space`);
      setName("");
      setPersonality("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add agent", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-orange-500 transition-colors font-medium"
        title="Add an AI agent to this space"
      >
        + Agent
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onMouseDown={() => setOpen(false)}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">Add an Agent</p>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-[11px] text-gray-400 -mt-2">
          All agents share a biblical worldview as their foundation.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name (e.g. Father Marcus)"
            maxLength={40}
            autoFocus
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <textarea
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="Describe their personality, occupation, or focus — e.g. a retired pastor who loves church history and finds deep connections between scripture and modern science"
            maxLength={600}
            rows={3}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200 text-gray-700 placeholder:text-gray-400"
          />
          <button
            type="submit"
            disabled={!name.trim() || !personality.trim() || submitting}
            className="bg-orange-500 text-white rounded-xl py-2 text-sm font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
          >
            {submitting ? "Adding…" : "Add Agent"}
          </button>
        </form>
      </div>
    </div>
  );
}
