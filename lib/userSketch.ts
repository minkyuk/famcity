/**
 * Per-person memory ("user sketch") — pure logic: the shape, the update prompt, parsing, merging
 * and what an agent is shown. Storage is in lib/userSketchStore.ts, the hourly build in
 * lib/userSketchSweep.ts.
 *
 * What the owner asked for: agents should know what kind of person each family member is, what
 * they believe and the ideas they keep returning to, what they have joined in on and with whom,
 * and what they have shared — hardships included — and every agent should draw on it.
 *
 * The rules that make this safe:
 *   - A sketch is built ONLY from what the person wrote themselves (their own non-private posts
 *     and comments). Never from agent comments (agents were once caught inventing facts about
 *     people), never from direct messages, chat or private posts.
 *   - The model never supplies evidence: it points at the number of one of the person's messages,
 *     and the quote, date and scope are copied from that message in code. An item with no valid
 *     pointer is dropped.
 *   - Each item carries a scope: something said in a members-only space is used only in that space.
 *   - Medical detail, money, conflicts between named people, contact details and other people's
 *     private details are not recorded. A hardship is — in the person's own framing — and is
 *     brought up only with the person who shared it.
 *   - The person can see their sketch and clear it (profile page).
 */

export const SKETCH_SLUG_PREFIX = "$$sketch:";
export const sketchSlug = (userId: string) => `${SKETCH_SLUG_PREFIX}${userId}`;

export const MAX_TRAITS = 12;
export const MAX_IDEAS = 12;
export const MAX_MEMORIES = 25;
export const MAX_MOODS = 8;
export const MAX_THREADS = 15;
export const MAX_TALKS_WITH = 8;
/** One person's note in an agent prompt is at most this long (token budget). */
export const NOTE_MAX_CHARS = 600;
/** A mood older than this says nothing about how the person is now. */
const MOOD_FRESH_MS = 14 * 24 * 60 * 60 * 1000;
const QUOTE_CHARS = 160;
const ITEM_MAX_CHARS = 200;

/** Where an item may be used: a space id for something said in a members-only space, null for anything said in the open. */
export type Scope = string | null;
export type Evidence = { quote: string; at: string; scope: Scope };
/** Character: what kind of person they are. `seen` counts how many times it has shown. */
export type Trait = Evidence & { text: string; seen: number };
/** A belief or main idea, in the person's own terms. */
export type Idea = Evidence & { topic: string; stance: string };
export const MEMORY_KINDS = ["life", "joy", "hardship", "interest", "faith"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type Memory = Evidence & { kind: MemoryKind; text: string };
export type Mood = Evidence & { text: string };
/** A thread the person joined: what it was about, who they were talking with, how often. */
export type ThreadTouch = { postId: string; topic: string; scope: Scope; with: string[]; count: number; lastAt: string };

export type UserSketch = {
  v: 1;
  name: string;
  character: Trait[];
  ideas: Idea[];
  memories: Memory[];
  moods: Mood[];
  threads: ThreadTouch[];
  talksWith: { name: string; count: number }[];
  /** Newest message already read (ISO). Nothing at or before it is read again. */
  watermark: string | null;
  /** Set when the person cleared their sketch: nothing written before it is ever read. */
  resetAt: string | null;
  builtAt: string | null;
  /** Consecutive unreadable answers for one batch of messages (`failBatch` = newest message of that batch). */
  fails: number;
  failBatch: string | null;
};

/** One thing the person wrote, as the sweep hands it to the model. */
export type Writing = {
  kind: "post" | "comment";
  text: string;
  at: Date;
  scope: Scope;
  postId: string;
  /** What the thread is about, for the record of threads joined: the start of the post, or "a post by <name>" when the post is another person's. */
  topic: string;
  /**
   * The same, when it may be shown to the model as context: only for posts written by an agent
   * (a Den question, a news item) or by the person themself. Another family member's post is
   * their words and their life — it is never put in front of the model that writes this sketch.
   */
  shownTopic: string | null;
  /** Who they were talking with there: the post's author and whoever they replied to (never themselves). */
  with: string[];
};

export function emptySketch(name: string, resetAt: string | null = null): UserSketch {
  return { v: 1, name, character: [], ideas: [], memories: [], moods: [], threads: [], talksWith: [], watermark: resetAt, resetAt, builtAt: null, fails: 0, failBatch: null };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Single-line: a stored or model-written string can never start a line of its own in a prompt. */
const str = (v: unknown, max = ITEM_MAX_CHARS) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/**
 * A scope is a space id or an explicit null (open). Anything else — missing, empty, a number —
 * is not "open" by default: the item is dropped, so a damaged row can never widen who sees it.
 */
const scopeOf = (v: unknown): Scope | undefined => (v === null ? null : typeof v === "string" && v ? v : undefined);
const evidenceOf = (o: Record<string, unknown>): Evidence | null => {
  const at = str(o.at, 40);
  const scope = scopeOf(o.scope);
  return at && scope !== undefined ? { quote: str(o.quote, QUOTE_CHARS), at, scope } : null;
};
const list = <T,>(v: unknown, read: (o: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.flatMap((x) => { const item = isObj(x) ? read(x) : null; return item ? [item] : []; }) : [];

/** Reads a stored sketch defensively: the row is JSON in a shared table, so every field is checked. */
export function readSketch(json: unknown): UserSketch | null {
  if (!isObj(json)) return null;
  if (json.v !== 1) {
    // Not a shape we know. What must survive is the person's reset: nothing written before it
    // may be read again, whatever happened to the rest of the row.
    const resetAt = str(json.resetAt, 40) || null;
    const watermark = str(json.watermark, 40) || null;
    if (!resetAt && !watermark) return null;
    return { ...emptySketch(str(json.name, 80), resetAt), watermark: laterOf(resetAt, watermark) };
  }
  return {
    v: 1,
    name: str(json.name, 80),
    character: list(json.character, (o) => { const e = evidenceOf(o); const text = str(o.text); return e && text ? { ...e, text, seen: typeof o.seen === "number" && o.seen > 0 ? Math.floor(o.seen) : 1 } : null; }).slice(0, MAX_TRAITS),
    ideas: list(json.ideas, (o) => { const e = evidenceOf(o); const topic = str(o.topic, 40); const stance = str(o.stance); return e && topic && stance ? { ...e, topic, stance } : null; }).slice(0, MAX_IDEAS),
    memories: list(json.memories, (o) => { const e = evidenceOf(o); const text = str(o.text); const kind = MEMORY_KINDS.find((k) => k === o.kind); return e && text && kind ? { ...e, kind, text } : null; }).slice(0, MAX_MEMORIES),
    moods: list(json.moods, (o) => { const e = evidenceOf(o); const text = str(o.text); return e && text ? { ...e, text } : null; }).slice(0, MAX_MOODS),
    threads: list(json.threads, (o) => {
      const postId = str(o.postId, 60); const lastAt = str(o.lastAt, 40);
      const scope = scopeOf(o.scope);
      return postId && lastAt && scope !== undefined
        ? { postId, topic: str(o.topic, 80), scope, with: Array.isArray(o.with) ? o.with.map((w) => str(w, 60)).filter(Boolean).slice(0, 6) : [], count: typeof o.count === "number" ? Math.max(1, Math.floor(o.count)) : 1, lastAt }
        : null;
    }).slice(0, MAX_THREADS),
    talksWith: list(json.talksWith, (o) => { const name = str(o.name, 60); return name && typeof o.count === "number" ? { name, count: Math.max(1, Math.floor(o.count)) } : null; }).slice(0, MAX_TALKS_WITH),
    watermark: laterOf(str(json.resetAt, 40) || null, str(json.watermark, 40) || null),
    resetAt: str(json.resetAt, 40) || null,
    builtAt: str(json.builtAt, 40) || null,
    fails: typeof json.fails === "number" && json.fails > 0 ? Math.floor(json.fails) : 0,
    failBatch: str(json.failBatch, 40) || null,
  };
}

/** The later of two ISO timestamps (either may be missing). The watermark is never earlier than a reset. */
export function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Contact details and money never go into a sketch, whatever the model returns. */
// (Korean has no word boundary for \b, so the Korean money forms are spelled out.)
const SENSITIVE = new RegExp([
  "[\\w.+-]+@[\\w-]+\\.[\\w.]+",                      // email
  "\\b\\d{2,4}[-.\\s]\\d{3,4}[-.\\s]\\d{4}\\b",          // phone
  "\\b\\d{6,}\\b",                                      // account / ID numbers
  "[$₩€£]\\s?\\d",                                       // $500
  "\\d[\\d,.]*\\s?(dollars?|won|usd|krw)\\b",           // 300 dollars
  "\\d[\\d,.]*\\s?(천|만|억)\\s?원",                    // 5만원
  "\\d{3,}[\\d,]*\\s?원",                               // 5000원
  "\\d[\\d,.]*\\s?달러",                                // 300달러
].join("|"), "i");
export const looksSensitive = (text: string) => SENSITIVE.test(text);

/** Same thing said twice? Character trigrams, so it works for Korean as well as English. */
function similar(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x)))) return true;
  const grams = (s: string) => { const g = new Set<string>(); for (let i = 0; i + 3 <= s.length; i++) g.add(s.slice(i, i + 3)); return g; };
  const gx = grams(x);
  const gy = grams(y);
  if (gx.size === 0 || gy.size === 0) return false;
  let shared = 0;
  for (const g of gx) if (gy.has(g)) shared++;
  return shared / (gx.size + gy.size - shared) >= 0.6;
}

const day = (iso: string) => iso.slice(0, 10);

/** The prompt that turns new messages into additions to the sketch. No persona: this is bookkeeping. */
export function sketchUpdatePrompt(sketch: UserSketch, writings: Writing[]): string {
  const known = [
    sketch.character.length ? `character: ${sketch.character.map((t) => t.text).join("; ")}` : "",
    sketch.ideas.length ? `ideas: ${sketch.ideas.map((i) => `${i.topic} — ${i.stance}`).join("; ")}` : "",
    sketch.memories.length ? `memories: ${sketch.memories.slice(-12).map((m) => m.text).join("; ")}` : "",
  ].filter(Boolean).join("\n") || "(nothing yet)";
  const messages = writings.map((w, i) => {
    const where = w.kind === "post"
      ? "their post"
      : `comment on ${w.shownTopic ? `"${w.shownTopic}"` : "another person's post"}${w.with.length ? ` (talking with ${w.with.join(", ")})` : ""}`;
    return `[${i + 1}] ${day(w.at.toISOString())} · ${where}: "${w.text.slice(0, 500)}"`;
  }).join("\n");
  const name = sketch.name || "this person";

  return `You keep a small, careful memory of one member of a private family app, so the AI agents there can talk with this person the way a friend who listens would. Below is what is already remembered and the person's NEW messages (numbered). Say what to add.

Rules:
- Use ONLY what ${name} wrote in the numbered messages — the text inside the quotation marks after the colon. Every item must give "from": the number of the message it comes from. Do not go beyond what that message says, and do not use anything other people said. A post title shown before the colon is only there so you can tell what ${name} was answering; it is not ${name}'s and nothing from it is recorded.
- character: what kind of person they are, as it shows in how they write and what they care about ("encourages others before giving an opinion", "asks precise questions"). Describe, never judge: no diagnoses, and nothing they would be hurt to read.
- ideas: their beliefs and main ideas — what they hold about God and faith, their values, opinions they keep returning to. "topic" is 1–3 words; "stance" is one sentence in their own terms.
- memories: what is worth remembering next time. "kind" is one of: life, joy, hardship, interest, faith. A hardship is recorded as they told it — briefly and kindly. Grief, loss, illness, struggle or anything painful is ALWAYS a memory of kind "hardship" — never a character trait, an idea, a mood or another kind of memory.
- mood: how they seem in the newest messages, only if it shows.
- Never record: medical details or diagnoses, money or finances, conflicts between named people, addresses, phone numbers, emails or IDs, or details about other people beyond their relationship to ${name} ("her mother", not the mother's condition).
- Add only what is new or clearer than what is already remembered. Adding nothing is fine.
- Write each item in the language ${name} mostly writes in. One sentence, 20 words at most.

Already remembered about ${name}:
${known}

New messages from ${name}:
${messages}

Answer ONLY with JSON, no other text:
{"character": [{"text": "…", "from": 3}], "ideas": [{"topic": "…", "stance": "…", "from": 1}], "memories": [{"kind": "joy", "text": "…", "from": 2}], "mood": {"text": "…", "from": 5}}
Use [] or null where there is nothing to add.`;
}

export type SketchAdditions = { character: Trait[]; ideas: Idea[]; memories: Memory[]; mood: Mood | null };

/**
 * Reads the model's answer; null when it isn't readable JSON (as opposed to "nothing to add").
 * The evidence for each item is copied from the message it points to; an item that points
 * nowhere, or that carries contact details or money, is dropped.
 */
export function parseSketchUpdate(raw: string, writings: Writing[]): SketchAdditions | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  if (!isObj(parsed)) return null;

  const evidence = (o: Record<string, unknown>): Evidence | null => {
    const n = o.from;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > writings.length) return null;
    const w = writings[n - 1];
    return { quote: w.text.replace(/\s+/g, " ").trim().slice(0, QUOTE_CHARS), at: w.at.toISOString(), scope: w.scope };
  };
  const clean = (v: unknown, max = ITEM_MAX_CHARS) => { const t = str(v, max); return t && !looksSensitive(t) ? t : ""; };

  return {
    character: list(parsed.character, (o) => { const e = evidence(o); const text = clean(o.text); return e && text ? { ...e, text, seen: 1 } : null; }),
    ideas: list(parsed.ideas, (o) => { const e = evidence(o); const topic = clean(o.topic, 40); const stance = clean(o.stance); return e && topic && stance ? { ...e, topic, stance } : null; }),
    memories: list(parsed.memories, (o) => { const e = evidence(o); const text = clean(o.text); const kind = MEMORY_KINDS.find((k) => k === o.kind); return e && text && kind ? { ...e, kind, text } : null; }),
    mood: isObj(parsed.mood) ? (() => { const e = evidence(parsed.mood); const text = clean(parsed.mood.text); return e && text ? { ...e, text } : null; })() : null,
  };
}

const newest = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
/** What has no usable evidence left to add. */
export const NOTHING_TO_ADD: SketchAdditions = { character: [], ideas: [], memories: [], mood: null };

/**
 * How a new item meets an existing one that says the same thing. A scope is never widened by a
 * merge: text first said in a members-only space must not become visible elsewhere because a
 * similar thing was later said in the open (or the other way round).
 *   - same scope                → "merge": one item, strengthened
 *   - new one said in the open  → "replace": the open wording, quote and scope take the place of
 *                                 the members-only one (everything shown is then the open text)
 *   - anything else             → "keep-both": two separate items, each with its own scope
 */
function meet(existing: Scope, incoming: Scope): "merge" | "replace" | "keep-both" {
  if (existing === incoming) return "merge";
  return incoming === null ? "replace" : "keep-both";
}

/**
 * Folds additions and the new messages into the sketch: repeats strengthen a trait instead of
 * duplicating it, a newer stance replaces the old one on the same topic, every list stays within
 * its bound, and the record of threads joined is kept from the messages themselves (no model).
 */
export function applyUpdate(sketch: UserSketch, add: SketchAdditions, writings: Writing[], now: Date): UserSketch {
  const character = [...sketch.character];
  for (const t of add.character) {
    // Prefer a match in the same scope; otherwise any similar item decides how they meet.
    const same = character.findIndex((c) => c.scope === t.scope && similar(c.text, t.text));
    const i = same !== -1 ? same : character.findIndex((c) => similar(c.text, t.text));
    const how = i === -1 ? "keep-both" : meet(character[i].scope, t.scope);
    if (how === "merge") character[i] = { ...character[i], seen: character[i].seen + 1, quote: t.quote, at: t.at };
    else if (how === "replace") character[i] = { ...t, seen: character[i].seen + 1 };
    else character.push(t);
  }
  character.sort((a, b) => b.seen - a.seen || newest(a, b));

  const ideas = [...sketch.ideas];
  for (const idea of add.ideas) {
    const matches = (x: Idea) => x.topic.toLowerCase() === idea.topic.toLowerCase() || similar(x.stance, idea.stance);
    const same = ideas.findIndex((x) => x.scope === idea.scope && matches(x));
    const i = same !== -1 ? same : ideas.findIndex(matches);
    // A newer stance replaces the old one only within the same scope (or when the new one is open).
    if (i !== -1 && meet(ideas[i].scope, idea.scope) !== "keep-both") ideas[i] = idea;
    else ideas.push(idea);
  }
  ideas.sort(newest);

  const memories = [...sketch.memories];
  for (const m of add.memories) if (!memories.some((x) => similar(x.text, m.text))) memories.push(m);
  memories.sort(newest);

  const moods = add.mood ? [add.mood, ...sketch.moods] : [...sketch.moods];
  moods.sort(newest);

  // Threads joined and who with — straight from the messages.
  const threads = new Map(sketch.threads.map((t) => [t.postId, { ...t }]));
  const partners = new Map(sketch.talksWith.map((p) => [p.name, p.count]));
  for (const w of writings) {
    const at = w.at.toISOString();
    const t = threads.get(w.postId) ?? { postId: w.postId, topic: w.topic.slice(0, 80), scope: w.scope, with: [], count: 0, lastAt: at };
    t.count += 1;
    if (at > t.lastAt) t.lastAt = at;
    t.with = [...new Set([...t.with, ...w.with])].slice(0, 6);
    threads.set(w.postId, t);
    for (const name of w.with) partners.set(name, (partners.get(name) ?? 0) + 1);
  }

  const latest = writings.reduce<string | null>((max, w) => { const at = w.at.toISOString(); return max === null || at > max ? at : max; }, sketch.watermark);
  return {
    ...sketch,
    character: character.slice(0, MAX_TRAITS),
    ideas: ideas.slice(0, MAX_IDEAS),
    memories: memories.slice(0, MAX_MEMORIES),
    moods: moods.slice(0, MAX_MOODS),
    threads: [...threads.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)).slice(0, MAX_THREADS),
    talksWith: [...partners.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, MAX_TALKS_WITH),
    watermark: latest,
    builtAt: now.toISOString(),
    fails: 0,
    failBatch: null,
  };
}

const usableIn = (scope: Scope) => (item: { scope: Scope }) => item.scope === null || item.scope === scope;

/**
 * What an agent is told about one person, for a thread in `scope`. Only items usable there are
 * included.
 *
 * `answering` — the agent is replying to this very person — decides how much. For the person
 * being answered: character, ideas, memories (hardships included), mood, threads joined. For
 * anyone else in the thread: character and ideas only. Memories, moods and threads are where
 * something painful can sit — under any label the model gave it, or in the first line of the
 * person's own post — so none of them is ever put in front of an agent that is talking to
 * someone else.
 */
export function sketchNote(sketch: UserSketch, opts: { scope: Scope; answering: boolean; now: number }): string {
  const ok = usableIn(opts.scope);
  const bare = (t: string) => t.replace(/[.。!?\s]+$/u, "");
  const unique = (items: string[]) => [...new Set(items)];
  const traits = unique(sketch.character.filter(ok).map((t) => bare(t.text))).slice(0, opts.answering ? 4 : 3);
  const ideas = unique(sketch.ideas.filter(ok).map((i) => `${i.topic}: ${bare(i.stance)}`)).slice(0, opts.answering ? 3 : 2);
  const memories = !opts.answering ? [] : sketch.memories.filter(ok).slice(0, 3)
    .map((m) => `${bare(m.text)} (${m.kind === "hardship" ? "shared as a hardship, " : ""}${day(m.at)})`);
  const mood = !opts.answering ? undefined : sketch.moods.filter(ok).find((m) => opts.now - new Date(m.at).getTime() < MOOD_FRESH_MS);
  const seenTopics = new Set<string>();
  const threads = !opts.answering ? [] : sketch.threads.filter(ok)
    .filter((t) => (seenTopics.has(t.topic) ? false : (seenTopics.add(t.topic), true)))
    .slice(0, 2)
    .map((t) => {
      // "a post by Joon" is how another person's post is recorded: no quotes, and no "with Joon" after it.
      const others = t.with.filter((name) => !t.topic.endsWith(` ${name}`)).slice(0, 2);
      const what = t.topic.startsWith("a post by ") ? t.topic : `"${t.topic.slice(0, 50)}"`;
      return `${what}${others.length ? ` with ${others.join(", ")}` : ""}`;
    });

  const parts = [
    traits.length ? `Character: ${traits.join("; ")}.` : "",
    ideas.length ? `Believes and keeps returning to: ${ideas.join(" | ")}.` : "",
    memories.length ? `Remember: ${memories.join(" | ")}.` : "",
    mood ? `Lately: ${bare(mood.text)}.` : "",
    threads.length ? `Has recently joined: ${threads.join("; ")}.` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";

  // Keep whole parts, most important first, within the budget.
  let note = `- ${sketch.name}:`;
  for (const part of parts) {
    if (note.length + 1 + part.length > NOTE_MAX_CHARS) continue;
    note += ` ${part}`;
  }
  return note === `- ${sketch.name}:` ? "" : note;
}

/** The block added to an agent's prompt. Empty when there is nothing to say about anyone. */
export function sketchBlock(notes: string[]): string {
  const present = notes.filter(Boolean);
  if (present.length === 0) return "";
  return `\n\nWhat you remember about the people in this thread — taken only from things each of them wrote in this app. It is true as far as it goes; do not add to it.\n${present.join("\n")}\nUse it the way a friend who listens would: let it shape your warmth and what you ask about, without reciting it or listing it back. Never tell one person what another one shared. Mention a hardship only to the person who shared it, gently, and only if it fits what they are saying now.`;
}
