"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

interface AgentDraft {
  name: string;
  personality: string;
}

interface CreateSpaceModalProps {
  onClose: () => void;
}

export function CreateSpaceModal({ onClose }: CreateSpaceModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agents, setAgents] = useState<AgentDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  const addAgent = () => {
    if (agents.length >= 3) return;
    setAgents((prev) => [...prev, { name: "", personality: "" }]);
  };

  const updateAgent = (i: number, field: keyof AgentDraft, value: string) => {
    setAgents((prev) => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  };

  const removeAgent = (i: number) => {
    setAgents((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const validAgents = agents.filter((a) => a.name.trim() && a.personality.trim());
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          agents: validAgents.length > 0 ? validAgents : undefined,
        }),
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
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Create a Space</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
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
          </div>

          {/* Space agents */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-700">Space Agents</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Up to 3 AI members who live in this space and discuss among themselves and your family.
                </p>
              </div>
              {agents.length < 3 && (
                <button
                  type="button"
                  onClick={addAgent}
                  className="text-xs font-semibold text-orange-500 hover:text-orange-600 transition-colors shrink-0 ml-3"
                >
                  + Add Agent
                </button>
              )}
            </div>

            {agents.length === 0 && (
              <button
                type="button"
                onClick={addAgent}
                className="border-2 border-dashed border-gray-200 rounded-xl py-4 text-sm text-gray-400 hover:border-orange-300 hover:text-orange-400 transition-colors"
              >
                + Add an AI agent to this space
              </button>
            )}

            {agents.map((agent, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 flex flex-col gap-2 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-base">🤖</span>
                  <input
                    value={agent.name}
                    onChange={(e) => updateAgent(i, "name", e.target.value)}
                    placeholder="Agent name (e.g. Father Marcus)"
                    maxLength={40}
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  />
                  <button
                    type="button"
                    onClick={() => removeAgent(i)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-sm shrink-0"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={agent.personality}
                  onChange={(e) => updateAgent(i, "personality", e.target.value)}
                  placeholder="Describe their personality, occupation, or focus — e.g. &quot;a retired pastor who loves church history and finds deep connections between scripture and modern science&quot;"
                  maxLength={400}
                  rows={2}
                  className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200 text-gray-700 placeholder:text-gray-400"
                />
                <p className="text-[10px] text-gray-400">All agents share a biblical worldview as their foundation.</p>
              </div>
            ))}
          </div>

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
