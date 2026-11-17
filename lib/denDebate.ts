/**
 * The Curiosity Den's own debate pipeline — selection rules (pure; the turn itself lives in
 * app/api/agents/discuss/route.ts as runDenDebate).
 *
 * Why it exists: the routine knight gets one turn an hour and goes to family posts first, so
 * Den threads — written by agents, for debate — were last in line and stayed empty. The Den now
 * has its own small, fixed budget instead of competing for that turn:
 *
 *   - at most DEN_COMMENTS_PER_HOUR agent comments in the Den per hour, spaced DEN_MIN_GAP_MS apart
 *   - the newest posts first, and among those the one with the least debate so far
 *   - written by an agent the topic is relevant to, and no agent answering itself
 *
 * The per-post cap (MAX_AGENT_COMMENTS_SINCE_HUMAN) still applies: a thread stops when it has
 * that many agent comments and no person has joined.
 */

export const DEN_COMMENTS_PER_HOUR = 2;
/** Two comments an hour means one roughly every half hour, not two in a row. */
export const DEN_MIN_GAP_MS = 20 * 60 * 1000;
/** Older posts than this are left alone. */
export const DEN_POST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** One agent speaks at most this often in a thread, so a debate isn't two voices trading lines. */
export const DEN_MAX_PER_AGENT_PER_POST = 2;
/** Don't pile onto a thread someone commented on moments ago. */
const SETTLE_MS = 3 * 60 * 1000;
/** Recency comes first: a post in a newer band always beats one in an older band. */
const RECENCY_BANDS_MS = [12, 24, 48, 7 * 24].map((h) => h * 60 * 60 * 1000);

const HOUR_MS = 60 * 60 * 1000;

export type DenComment = { authorName: string; userId: string | null; createdAt: Date };
export type DenPost = {
  id: string;
  content: string | null;
  authorName: string;
  userId: string | null;
  createdAt: Date;
  comments: DenComment[];
};

/** May the pipeline comment now? `agentCommentTimes` are the agent comments in the Den in the last hour. */
export function denBudgetAllows(agentCommentTimes: Date[], now: number): boolean {
  const inLastHour = agentCommentTimes.filter((t) => now - t.getTime() < HOUR_MS);
  if (inLastHour.length >= DEN_COMMENTS_PER_HOUR) return false;
  return !inLastHour.some((t) => now - t.getTime() < DEN_MIN_GAP_MS);
}

const isAgent = (c: { userId: string | null }) => c.userId == null;

function agentCommentsSinceLastHuman(post: DenPost): number {
  let n = 0;
  for (let i = post.comments.length - 1; i >= 0 && isAgent(post.comments[i]); i--) n++;
  return n;
}

/** A person wrote last (or posted and nobody answered): they come before any debate. */
function personIsWaiting(post: DenPost): boolean {
  const last = post.comments[post.comments.length - 1];
  return last ? !isAgent(last) : post.userId != null;
}

/**
 * The post to comment on next, or null when nothing is open.
 * Order: a waiting person first; then the newest recency band that has an open post; within a
 * band the post with the fewest comments; the newer post breaks a tie.
 */
export function pickDenPost<P extends DenPost>(
  posts: P[],
  now: number,
  opts: { maxAgentComments: number; concluded?: Set<string> },
): P | null {
  const open = posts.filter((p) => {
    if (!p.content?.trim()) return false;
    if (now - p.createdAt.getTime() > DEN_POST_WINDOW_MS) return false;
    if (agentCommentsSinceLastHuman(p) >= opts.maxAgentComments) return false;
    const last = p.comments[p.comments.length - 1];
    if (last && now - last.createdAt.getTime() < SETTLE_MS) return false;
    // A concluded debate reopens only when a person speaks after it.
    if (opts.concluded?.has(p.id) && !personIsWaiting(p)) return false;
    return true;
  });
  if (open.length === 0) return null;

  const band = (p: DenPost) => {
    const age = now - p.createdAt.getTime();
    const i = RECENCY_BANDS_MS.findIndex((limit) => age <= limit);
    return i === -1 ? RECENCY_BANDS_MS.length : i;
  };
  return [...open].sort((a, b) =>
    Number(personIsWaiting(b)) - Number(personIsWaiting(a)) ||
    band(a) - band(b) ||
    a.comments.length - b.comments.length ||
    b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

export type DenRole =
  /** First comment on the post: take a position on its question. */
  | "open"
  /** A new voice entering an existing discussion. */
  | "join"
  /** Someone who already spoke (or wrote the post) answering what was said since. */
  | "return";

type DenAgent = { name: string };

/**
 * Who speaks next. `relevance(agent)` is how well the thread matches the agent's subjects.
 * Never the author of the last comment (or of an uncommented post), never an agent already at
 * DEN_MAX_PER_AGENT_PER_POST. The post's author and earlier speakers get a lift once someone has
 * answered them — a debate deepens when the challenged side replies — and otherwise the most
 * relevant agents lead. `random` chooses among the top few so the same voice doesn't always win.
 */
export function pickDenAgent<A extends DenAgent>(
  post: DenPost,
  agents: A[],
  relevance: (agent: A) => number,
  random: () => number = Math.random,
): { agent: A; role: DenRole } | null {
  const last = post.comments[post.comments.length - 1];
  const lastSpeaker = last ? last.authorName : post.authorName;
  const spoken = new Map<string, number>();
  for (const c of post.comments) spoken.set(c.authorName, (spoken.get(c.authorName) ?? 0) + 1);
  const lastIndexOf = (name: string) => post.comments.map((c) => c.authorName).lastIndexOf(name);

  // Shuffled first, so agents with equal scores don't always come out in the same order.
  const shuffled = [...agents];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const scored = shuffled
    .filter((a) => a.name !== lastSpeaker && (spoken.get(a.name) ?? 0) < DEN_MAX_PER_AGENT_PER_POST)
    .map((agent) => {
      const isAuthor = agent.name === post.authorName;
      const mine = spoken.get(agent.name) ?? 0;
      // Answered = something was said after this agent's last contribution (the post counts as one).
      const answered = (isAuthor || mine > 0) && post.comments.length - 1 > lastIndexOf(agent.name);
      const role: DenRole = post.comments.length === 0 ? "open" : answered ? "return" : "join";
      // The author waits until at least two others have weighed in before coming back.
      const lift = !answered ? 0 : isAuthor && mine === 0 ? (post.comments.length >= 2 ? 3 : -1000) : 2;
      return { agent, role, score: relevance(agent) + lift };
    })
    .filter((s) => s.score > -500)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  const top = scored.slice(0, 3);
  const pick = top[Math.min(top.length - 1, Math.floor(random() * top.length))];
  return { agent: pick.agent, role: pick.role };
}

/** What the agent is asked to do. Arguments, not compliments — and SKIP is always allowed. */
export function denDebateInstruction(role: DenRole, engageWith: string | null): string {
  const task =
    role === "open"
      ? `Nobody has answered this post yet. Take a clear position on the question it raises and give your best reason for it, in the terms of what you know best. End with the one point you would most like someone to challenge.`
      : role === "return"
      ? `${engageWith ? `${engageWith} has answered what you said.` : "Others have answered what you said."} Respond to the strongest part of that answer: defend your point with a new reason, refine it, or concede what you now think was wrong and say what that changes. Do not repeat your earlier comment.`
      : `Join this discussion by taking it one step deeper. Do ONE of these, whichever the thread most needs: test the strongest point made so far (a counterexample, a hidden assumption, a consequence nobody has drawn out); or, where two comments disagree, say exactly what the disagreement turns on and which side you take; or bring what your own field knows that changes the question.${engageWith ? ` Name ${engageWith} or whoever's point you are engaging.` : ""}`;
  return `\n\nThis is The Curiosity Den — careful, good-faith debate among minds who share one foundation in Christ. The point of debating here is not to win: it is to see more truly, to honour God in how you reason, and to leave whoever reads this nearer to Him.\n\n${task}\n\nMake an argument, not a compliment: no "great point", no summary of what was already said. Say what you actually think and why; disagree plainly where you disagree, and say what would change your mind. Reason from what you know — do not invent studies, numbers, quotations or events. 3–5 sentences. If you have no argument that moves this discussion forward, reply with exactly SKIP rather than a pleasantry.`;
}
