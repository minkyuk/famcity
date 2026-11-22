"use client";

import { useCallback, useEffect, useState } from "react";
import type { HeartSummary } from "@/lib/hearts";
import type { UserSketch } from "@/lib/userSketch";
import { SketchSection, type SketchRow } from "./SketchSection";

const day = (iso: string) => iso.slice(0, 10);

/**
 * "What the agents remember about you": the person's sketch, with the sentence each item came
 * from, and a button to clear it. Shown on the profile page to that person and to site admins.
 */
export function AgentSketchCard({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const [sketch, setSketch] = useState<UserSketch | null>(null);
  const [hearts, setHearts] = useState<HeartSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${userId}/sketch`);
      if (!res.ok) throw new Error(String(res.status));
      const data: { sketch: UserSketch | null; hearts?: HeartSummary[] } = await res.json();
      setSketch(data.sketch);
      setHearts(data.hearts ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  async function clear() {
    if (!window.confirm("Clear everything the agents remember about you? They will start again from what you write after this.")) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/users/${userId}/sketch`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      const data: { sketch: UserSketch | null } = await res.json();
      setSketch(data.sketch);
      setHearts([]);
    } catch {
      setState("error");
    } finally {
      setClearing(false);
    }
  }

  const character: SketchRow[] = (sketch?.character ?? []).map((t, i) => ({ key: `c${i}`, text: t.text, quote: t.quote, date: day(t.at) }));
  const ideas: SketchRow[] = (sketch?.ideas ?? []).map((x, i) => ({ key: `i${i}`, tag: x.topic, text: x.stance, quote: x.quote, date: day(x.at) }));
  const memories: SketchRow[] = (sketch?.memories ?? []).map((m, i) => ({ key: `m${i}`, tag: m.kind, text: m.text, quote: m.quote, date: day(m.at) }));
  const moods: SketchRow[] = (sketch?.moods ?? []).slice(0, 3).map((m, i) => ({ key: `d${i}`, text: m.text, date: day(m.at) }));
  const threads: SketchRow[] = (sketch?.threads ?? []).slice(0, 8).map((t) => ({
    key: t.postId,
    text: t.topic,
    date: `${t.count} comment${t.count === 1 ? "" : "s"}${t.with.length ? ` · with ${t.with.join(", ")}` : ""} · ${day(t.lastAt)}`,
  }));
  const heartRows: SketchRow[] = hearts.slice(0, 6).map((h) => ({
    key: `h-${h.agent}`,
    tag: `♥ ${h.count}`,
    text: h.agent,
    quote: h.lastTopic ?? undefined,
    date: day(h.lastAt),
  }));
  const empty = character.length + ideas.length + memories.length + moods.length + threads.length + heartRows.length === 0;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800">
            {isOwn ? "What the agents remember about you" : "What the agents remember about this person"}
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Built only from posts and comments {isOwn ? "you" : "they"} wrote, and the hearts {isOwn ? "you" : "they"} gave agents&apos; replies — never from private posts, messages or chat. Only{" "}
            {isOwn ? "you" : "they"} and the family admin can see it.
          </p>
        </div>
        {!empty && (
          <button
            onClick={clear}
            disabled={clearing}
            className="shrink-0 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-500 transition-colors hover:border-red-200 hover:text-red-500 disabled:opacity-50"
          >
            {clearing ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>

      {state === "loading" && <p className="text-sm text-gray-400">Loading…</p>}
      {state === "error" && <p className="text-sm text-red-500">Could not load this right now.</p>}
      {state === "ready" && empty && (
        <p className="text-sm text-gray-400">Nothing yet. The agents update this about once an hour from what {isOwn ? "you write" : "they write"}.</p>
      )}

      <SketchSection title="Character" rows={character} />
      <SketchSection title="Beliefs and main ideas" rows={ideas} />
      <SketchSection title="Remembered" rows={memories} />
      <SketchSection title="Lately" rows={moods} />
      <SketchSection title="Threads joined" rows={threads} />
      <SketchSection title="Hearts on agents' replies (last 30 days)" rows={heartRows} />
    </section>
  );
}
