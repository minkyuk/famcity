/**
 * Hearts people leave — ♥ on a comment, ❤️ on a post — as agents are told about them (pure).
 * Loading lives in lib/heartsStore.ts; the block is added to the memory block an agent gets
 * (`sketchContextFor`).
 *
 * What an agent is shown, and why only this:
 *   - In the thread it is writing in: which people hearted an AI comment there, and who hearted
 *     the post. Who hearted another person's comment is not shown anywhere in the app (only the
 *     count is), so agents are not told either.
 *   - For the person being answered: whose AI replies and posts they have hearted lately, and on
 *     what. Hearts on other people's words are left out: they say more about the other person.
 */

export const HEART_EMOJI = "❤️";
/** How far back a person's hearts are remembered. */
export const HEART_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;

/** A heart in the thread: `by` hearted the post, or a comment by `author` (an agent). */
export type ThreadHeart = { by: string; on: "post" | "comment"; author: string; snippet: string };
/** A heart the person gave an agent's reply or post. `topic` is shown only when it may be. */
export type PersonHeart = { agent: string; topic: string | null; at: Date };

const SNIPPET_CHARS = 50;
const MAX_TARGETS = 4;
const MAX_AGENTS = 3;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const names = (list: string[]) => [...new Set(list)].join(", ");

/** "Mina ♥ Luna's comment "…"; Mina, Joon ♥ the post" — or "" when nobody hearted anything. */
export function threadHeartsLine(hearts: ThreadHeart[]): string {
  if (hearts.length === 0) return "";
  const byTarget = new Map<string, { label: string; by: string[] }>();
  for (const h of hearts) {
    const key = h.on === "post" ? "post" : `${h.author}\u0000${h.snippet}`;
    const label = h.on === "post" ? "the post" : `${h.author}'s comment "${clip(h.snippet, SNIPPET_CHARS)}"`;
    const entry = byTarget.get(key) ?? { label, by: [] };
    entry.by.push(h.by);
    byTarget.set(key, entry);
  }
  const parts = [...byTarget.values()].slice(0, MAX_TARGETS).map((t) => `${names(t.by)} ♥ ${t.label}`);
  return `In this thread: ${parts.join("; ")}.`;
}

/** "Mina, lately: ♥ on Newton ×3, Luna ×2 (latest: "…")" — or "" when they hearted nothing. */
export function personHeartsLine(name: string, hearts: PersonHeart[]): string {
  if (hearts.length === 0 || !name) return "";
  const counts = new Map<string, number>();
  for (const h of hearts) counts.set(h.agent, (counts.get(h.agent) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_AGENTS).map(([agent, n]) => (n > 1 ? `${agent} ×${n}` : agent));
  const latest = [...hearts].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const on = latest.topic ? ` (latest on "${clip(latest.topic, SNIPPET_CHARS)}")` : "";
  return `${name}, lately: ♥ on what ${top.join(", ")} wrote${on}.`;
}

/** For the person's profile card: whose writing they hearted, most first. */
export type HeartSummary = { agent: string; count: number; lastAt: string; lastTopic: string | null };
export function summarizeHearts(hearts: PersonHeart[]): HeartSummary[] {
  const by = new Map<string, HeartSummary>();
  for (const h of [...hearts].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    const row = by.get(h.agent);
    if (row) row.count++;
    else by.set(h.agent, { agent: h.agent, count: 1, lastAt: h.at.toISOString(), lastTopic: h.topic ? clip(h.topic, 80) : null });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1));
}

/** The block added to an agent's prompt. Empty when nobody hearted anything. */
export function heartsBlock(lines: string[]): string {
  const present = lines.filter(Boolean);
  if (present.length === 0) return "";
  return `\n\nHearts people left (♥ — their way of saying something meant something to them):\n${present.map((l) => `- ${l}`).join("\n")}\nLet it tell you what lands with them. Don't list it back, and don't thank anyone for a heart.`;
}
