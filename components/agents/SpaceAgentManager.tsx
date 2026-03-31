"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";
import Link from "next/link";

type BeliefEntry = {
  topic: string;
  belief: string;
  confidence: number;
  changedCount: number;
  originalBelief: string;
};

type AgentData = {
  id: string;
  spaceId: string;
  slug: string;
  name: string;
  personality: string;
  beliefs: BeliefEntry[];
  evolvedCount: number;
};

type SpaceGroup = {
  spaceId: string;
  spaceName: string;
  agents: AgentData[];
};

const TOPIC_LABELS: Record<string, string> = {
  god_existence: "God's existence",
  consciousness: "Consciousness",
  morality_basis: "Moral foundation",
  meaning: "Meaning & purpose",
  afterlife: "Afterlife",
  free_will: "Free will",
};

function confidenceColor(c: number) {
  if (c >= 0.8) return "text-green-600";
  if (c >= 0.55) return "text-yellow-500";
  return "text-gray-400";
}

function AgentCard({ agent, spaceId, isAdmin, onUpdated, onDeleted }: {
  agent: AgentData;
  spaceId: string;
  isAdmin: boolean;
  onUpdated: (updated: AgentData) => void;
  onDeleted: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [personality, setPersonality] = useState(agent.personality);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { showToast } = useToast();

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), personality: personality.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      const updated = await res.json();
      onUpdated({ ...agent, name: updated.name, personality: updated.personality });
      setEditing(false);
      showToast("Agent updated");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteAgent = async () => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/agents/${agent.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      onDeleted(agent.id);
      showToast(`${agent.name} removed`);
    } catch {
      showToast("Failed to delete agent", "error");
    }
  };

  if (editing) {
    return (
      <div className="border border-orange-200 rounded-xl p-4 flex flex-col gap-3 bg-orange-50/20">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          placeholder="Agent name"
        />
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          maxLength={600}
          rows={4}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200 text-gray-700"
          placeholder="Personality description"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving || !name.trim() || !personality.trim()}
            className="bg-orange-500 text-white rounded-xl px-4 py-1.5 text-xs font-semibold disabled:opacity-40 hover:bg-orange-600 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setName(agent.name); setPersonality(agent.personality); }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-3"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-100 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => setExpanded((v) => !v)} className="flex items-start gap-2.5 text-left flex-1 min-w-0">
          <span className="text-xl leading-none mt-0.5 shrink-0">🤖</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-sm text-gray-800">{agent.name}</span>
              {agent.evolvedCount > 0 && (
                <span className="text-[10px] text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">
                  {agent.evolvedCount} evolved
                </span>
              )}
            </div>
            {!expanded && (
              <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{agent.personality}</p>
            )}
          </div>
        </button>
        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] text-gray-400 hover:text-orange-500 transition-colors"
            >
              Edit
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button onClick={deleteAgent} className="text-[11px] text-red-500 font-medium">Confirm</button>
                <button onClick={() => setConfirmDelete(false)} className="text-[11px] text-gray-400">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-[11px] text-gray-400 hover:text-red-500 transition-colors">
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <p className="text-[11px] text-gray-500 uppercase tracking-wide font-semibold mb-1">Personality</p>
            <p className="text-xs text-gray-700 leading-relaxed">{agent.personality}</p>
          </div>
          {agent.beliefs.length > 0 && (
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-wide font-semibold mb-2">Beliefs</p>
              <div className="flex flex-col gap-2">
                {agent.beliefs.map((b) => (
                  <div key={b.topic} className={`rounded-lg border p-2.5 ${b.changedCount > 0 ? "border-orange-200 bg-orange-50/30" : "border-gray-100"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-gray-700">{TOPIC_LABELS[b.topic] ?? b.topic}</span>
                      <span className={`text-[11px] font-medium ${confidenceColor(b.confidence)}`}>
                        {Math.round(b.confidence * 100)}%
                        {b.changedCount > 0 && <span className="text-orange-400 ml-1">changed {b.changedCount}×</span>}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-600 leading-relaxed">{b.belief}</p>
                    {b.changedCount > 0 && b.originalBelief !== b.belief && (
                      <p className="text-[10px] text-gray-300 mt-1 line-through">{b.originalBelief}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {agent.beliefs.length === 0 && (
            <p className="text-[11px] text-gray-400">No beliefs recorded yet — will develop through debate.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function SpaceAgentManager({ groups, isAdmin }: { groups: SpaceGroup[]; isAdmin: boolean }) {
  const [localGroups, setLocalGroups] = useState(groups);

  const handleUpdate = (spaceId: string, updated: AgentData) => {
    setLocalGroups((prev) =>
      prev.map((g) =>
        g.spaceId === spaceId
          ? { ...g, agents: g.agents.map((a) => (a.id === updated.id ? updated : a)) }
          : g
      )
    );
  };

  const handleDelete = (spaceId: string, agentId: string) => {
    setLocalGroups((prev) =>
      prev.map((g) =>
        g.spaceId === spaceId
          ? { ...g, agents: g.agents.filter((a) => a.id !== agentId) }
          : g
      ).filter((g) => g.agents.length > 0)
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {localGroups.map((group) => (
        <div key={group.spaceId}>
          <div className="flex items-center gap-2 mb-2">
            <Link href={`/spaces/${group.spaceId}`} className="text-sm font-semibold text-gray-700 hover:text-orange-500 transition-colors">
              {group.spaceName}
            </Link>
            <span className="text-xs text-gray-300">{group.agents.length} agent{group.agents.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-col gap-2">
            {group.agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                spaceId={group.spaceId}
                isAdmin={isAdmin}
                onUpdated={(updated) => handleUpdate(group.spaceId, updated)}
                onDeleted={(id) => handleDelete(group.spaceId, id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
