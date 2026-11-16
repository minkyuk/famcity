import { AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";

/**
 * Grounding: agents must never invent facts about the real people in the family.
 *
 * Incident that motivated this: a space agent wrote that a family member "was going to come over
 * in person tomorrow afternoon" under a post that said nothing of the kind, and later agents
 * repeated it as fact. Causes were prompt pressure to always add something new, a novelty gate
 * that rewarded invented detail, agent comments being indistinguishable from human ones in the
 * thread context, and no check on claims about people.
 */

/** Appended to every comment prompt. */
export const GROUNDING_INSTRUCTION = `\n\nTruthfulness about people (non-negotiable): the people in this app are a real family. The ONLY sources of facts about them are the post itself and comments written by people. Comments marked "(AI)" are from AI agents like you — respond to their ideas if you wish, but never treat anything they say about a person as true, and never repeat it. Do not invent or assume facts, plans, visits, actions, conversations, feelings, motives, or quotes for anyone — not "she was going to come by tomorrow", not "he told you that…". You may respond to what was actually written, share your own honest reaction, or offer general knowledge. If you have nothing true to add, one short warm sentence is a perfectly good comment. Never write the "(AI)" tag yourself.`;

/**
 * Extra line for paths that parse a SKIP reply (routine and space-agent comments). Only append it
 * when no person is waiting (see humanIsWaiting): a SKIP there would leave a family member
 * unanswered — and in the space path it also hides the post until someone comments again.
 */
export const GROUNDING_SKIP_NOTE = ` If even that would be filler, reply with exactly SKIP.`;

/** One-line version for prompts that write a new post rather than a comment. */
export const GROUNDING_POST_NOTE = `\n\nDo not invent facts, events, plans, or quotes about real people in this family.`;

/** Label for the "your recent comments" block: it comes from other threads and must not leak into this one. */
export const OTHER_THREADS_HISTORY_LABEL =
  "Your recent comments on OTHER threads (shown only so you don't repeat your own phrasing — nothing in them is about this thread; do not bring their people, events, or details here)";

type Speaker = { authorName: string; userId: string | null };

/** Name as shown in thread context: agents (no userId) are tagged so they can't pass as a source of facts. */
export const speakerLabel = (c: Speaker): string => (c.userId == null ? `${c.authorName} (AI)` : c.authorName);

type GroundingThread = {
  authorName: string;
  userId: string | null;
  content: string | null;
  comments: (Speaker & { body: string })[];
};

/**
 * True when a person is waiting on a reply: a human post nobody has answered, or a human comment
 * with no agent comment after it.
 */
export function humanIsWaiting(post: { userId: string | null; comments: { userId: string | null }[] }): boolean {
  let lastHuman = -1;
  for (let i = post.comments.length - 1; i >= 0; i--) {
    if (post.comments[i].userId != null) { lastHuman = i; break; }
  }
  if (lastHuman === -1) return post.userId != null && post.comments.length === 0;
  return !post.comments.slice(lastHuman + 1).some((c) => c.userId == null);
}

/**
 * Removes a "(AI)" tag the model copied from the thread context after a participant's name
 * ("Luna (AI) made a good point" → "Luna made a good point"). Only strips it after known names,
 * so ordinary text such as "artificial intelligence (AI)" is left alone.
 */
export function stripAiTags(text: string, post: { authorName: string; comments: { authorName: string }[] }): string {
  const names = [...new Set([post.authorName, ...post.comments.map((c) => c.authorName)])].filter(Boolean);
  let out = text;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`${escaped}\\s*\\(AI\\)`, "g"), name);
  }
  return out;
}

/** The check only matters when real people are in the thread (a human post or a human comment). */
export function involvesPeople(post: GroundingThread): boolean {
  return post.userId != null || post.comments.some((c) => c.userId != null);
}

/**
 * Pre-post gate: does the draft assert something about a real person that the post and the
 * people's own comments don't support? Returns true when the draft is safe to post.
 * `visibleMediaNote` tells the checker about attachments the agent could actually see, so
 * describing a photo isn't mistaken for invention. Fails open on API errors, like the other gates.
 */
export async function isGroundedAboutPeople(
  draft: string,
  post: GroundingThread,
  visibleMediaNote = ""
): Promise<boolean> {
  if (!involvesPeople(post)) return true;

  const humanComments = post.comments.filter((c) => c.userId != null).slice(-6);
  const sources = humanComments.length > 0
    ? humanComments.map((c) => `${c.authorName}: "${c.body.slice(0, 200)}"`).join("\n")
    : "(none)";

  try {
    const msg = await anthropicFor("discuss:isGrounded").messages.create({
      ...AGENT_REQUEST,
      max_tokens: 10,
      messages: [{
        role: "user",
        content: `You are checking an AI agent's draft comment in a private family app for invented facts about real people.

Post by ${speakerLabel(post)}: "${(post.content ?? "").slice(0, 900)}"${visibleMediaNote ? `\n${visibleMediaNote}` : ""}

Comments written by people (with the post, the only sources of facts):
${sources}

Draft comment: "${draft.slice(0, 700)}"

Does the draft assert a specific fact about a real person — something they did, said, planned, decided, or a detail of their life — that is NOT stated in the post or the people's comments above?
Answer NO for: empathy, congratulations, encouragement, questions, the agent's own opinions or general knowledge, and gentle readings of what was actually written ("it sounds like you feel relieved").
Answer YES for: invented events, plans, visits, conversations, quotes, or motives ("she was going to come over tomorrow afternoon", "he told you that…").
Reply with only YES or NO.`,
      }],
    });
    return !textOf(msg).trim().toUpperCase().startsWith("Y");
  } catch {
    return true;
  }
}
