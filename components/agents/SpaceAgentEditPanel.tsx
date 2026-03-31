"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

export function SpaceAgentEditPanel({
  agentId,
  spaceId,
  initialName,
  initialPersonality,
}: {
  agentId: string;
  spaceId: string;
  initialName: string;
  initialPersonality: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [personality, setPersonality] = useState(initialPersonality);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), personality: personality.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      setEditing(false);
      showToast("Agent updated");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="group relative">
        <p className="text-sm text-gray-700 leading-relaxed">{personality}</p>
        <button
          onClick={() => setEditing(true)}
          className="mt-2 text-xs text-gray-400 hover:text-orange-500 transition-colors"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-gray-400">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-gray-400">
          Personality description
          <span className="ml-1 text-gray-300">{personality.length}/600</span>
        </label>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          maxLength={600}
          rows={5}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200 text-gray-700"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !name.trim() || !personality.trim()}
          className="bg-orange-500 text-white rounded-xl px-4 py-1.5 text-xs font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => { setEditing(false); setName(initialName); setPersonality(initialPersonality); }}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
