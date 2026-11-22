"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

/** Limits match lib/spaceAgentNames.ts (not imported: that module pulls in every knight). */
const NAME_MAX = 40;
const PERSONALITY_MAX = 1000;

/**
 * ✏️ next to a space agent: rename it or rewrite its personality. Members of the space can do
 * this; the change applies from the agent's next turn, and a rename carries over to what it
 * already wrote in the space.
 */
export function EditAgentButton({ spaceId, agent }: { spaceId: string; agent: { id: string; name: string; personality: string } }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(agent.name);
  const [personality, setPersonality] = useState(agent.personality);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  const close = () => {
    setOpen(false);
    setName(agent.name);
    setPersonality(agent.personality);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !personality.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), personality: personality.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Failed to save");
      }
      showToast(`${name.trim()} updated`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title={`Edit ${agent.name}`}
        aria-label={`Edit ${agent.name}`}
        className="shrink-0 rounded px-1 text-xs text-gray-300 transition-colors hover:text-orange-500"
      >
        ✏️
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={close}>
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Edit agent · 에이전트 편집</p>
              <button onClick={close} className="text-lg leading-none text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={save} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">Name · 이름</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={NAME_MAX}
                  autoFocus
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">
                  Personality · 성격 <span className="text-gray-300">{personality.length}/{PERSONALITY_MAX}</span>
                </span>
                <textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  maxLength={PERSONALITY_MAX}
                  rows={6}
                  className="resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <span className="text-[11px] text-gray-400">
                  Add to it or rewrite it — 덧붙여 써도 되고 새로 써도 됩니다. The biblical foundation always comes first.
                </span>
              </label>
              <button
                type="submit"
                disabled={saving || !name.trim() || !personality.trim()}
                className="rounded-xl bg-orange-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
