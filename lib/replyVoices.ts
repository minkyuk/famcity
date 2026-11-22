/**
 * Who answers a person's comment, and who may add to the answer (pure rules; the turn itself is
 * answerPersonComment in app/api/agents/discuss/route.ts).
 *
 * Owner's rules: a person's input is never capped. The first reply is guaranteed; after it, any
 * relevant agent may add its own, from what it believes and who it is. In a space, that space's
 * own agents come first.
 */

/** The agent the person was talking to; one of the space's own agents; a knight. */
export type SpeakerKind = "addressed" | "space" | "knight";
export type RankedSpeaker = { slug: string; kind: SpeakerKind; relevance: number };

/** Knights invited to add their own reply to one comment, after the space's own agents. */
export const REPLY_VOICE_KNIGHTS = 3;
/** A comment shorter than this (letters only) with no question in it has nothing to add to. */
const VOICE_MIN_LETTERS = 15;

const KIND_ORDER: Record<SpeakerKind, number> = { addressed: 0, space: 1, knight: 2 };

/**
 * The order agents are asked in: the one the person was talking to, then the space's own agents,
 * then knights — each group by how much the thread is theirs to speak to. The sort is stable, so
 * shuffling the list first makes ties fall differently each time.
 */
export function orderSpeakers<T extends RankedSpeaker>(speakers: T[]): T[] {
  return [...speakers].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.relevance - a.relevance);
}

/**
 * Who is invited to add a reply once the comment has its first one: every one of the space's own
 * agents not heard yet, then the most relevant knights (only knights the thread actually touches).
 * `heard`: slugs that already replied or whose draft was dropped in this run.
 */
export function voicesAfter<T extends RankedSpeaker>(ordered: T[], heard: ReadonlySet<string>, maxKnights = REPLY_VOICE_KNIGHTS): T[] {
  const rest = ordered.filter((s) => !heard.has(s.slug));
  return [...rest.filter((s) => s.kind !== "knight"), ...rest.filter((s) => s.kind === "knight" && s.relevance > 0).slice(0, maxKnights)];
}

/**
 * Is there enough in the comment for others to add to — a question, or more than a few words?
 * "ㅋㅋ 좋아요" gets its one reply and no chorus.
 */
export function invitesVoices(text: string): boolean {
  const clean = text.replace(/https?:\/\/\S+/g, " ");
  return /[?？]/.test(clean) || clean.replace(/[^\p{L}\p{N}]/gu, "").length >= VOICE_MIN_LETTERS;
}

/**
 * How much of a space agent's own description shows up in the thread — a rough measure of whether
 * the thread is theirs to speak to (space agents have a description, not topic lists).
 * `threadText` must be lower-cased.
 */
export function personalityScore(threadText: string, personality: string): number {
  const words = new Set(
    personality
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= (/[가-힣]/.test(w) ? 2 : 4))
      .map((w) => (/^[a-z]{5,}$/.test(w) ? w.replace(/s$/, "") : w)), // "novels" also matches "novel"
  );
  let score = 0;
  for (const word of words) if (threadText.includes(word)) score++;
  return score;
}

export type Said = { name: string; body: string };

/**
 * What an agent is told when it may add a reply after others have answered. It is an invitation,
 * not a demand: silence (SKIP) is a fine answer, and nothing here asks for novelty at any price.
 */
export function voiceInstruction(to: string, said: Said[]): string {
  return `Already replied to this comment:
${said.map((s) => `${s.name} (AI): "${s.body.slice(0, 300)}"`).join("\n")}

You may add your own reply to ${to} under this comment — only if what you believe and who you are give you something of your own to say to ${to} that has not been said above. Speak to ${to}, not to the other replies; don't repeat them and don't merely agree. If you have nothing of your own to add, answer with exactly SKIP — staying silent is fine. 1–3 sentences. No hashtags.`;
}

/** The model chose silence. */
export const isSkip = (text: string) => /^\W*SKIP\b/i.test(text.trim());
