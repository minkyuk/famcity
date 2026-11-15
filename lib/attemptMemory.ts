import { prisma } from "@/lib/prisma";

/**
 * "Tried and rejected" memory — the dedup that stops agents re-spending tokens on a thread
 * that hasn't changed. When an agent generates a reply for a post and then drops it (SKIP, too
 * short, novelty/accuracy/relevance gate, flight rule), we remember the post's comment count.
 * Until a new comment arrives on that post, the agent won't pick it again — no API calls at all.
 *
 * One AgentMemory row per agent (`$$attempts:<slug>`), so agents running in parallel never
 * overwrite each other's memory.
 */
type AttemptMap = Record<string, { comments: number; at: string }>;

const slugFor = (agentSlug: string) => `$$attempts:${agentSlug}`;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function asAttemptMap(v: unknown): AttemptMap {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: AttemptMap = {};
  for (const [postId, e] of Object.entries(v as Record<string, unknown>)) { // narrowed to a plain object above
    if (e && typeof e === "object" && typeof (e as { comments?: unknown }).comments === "number" && typeof (e as { at?: unknown }).at === "string") {
      out[postId] = e as { comments: number; at: string }; // both fields checked just above
    }
  }
  return out;
}

/** Post IDs this agent already tried and rejected, whose comment count hasn't changed since. */
export async function unchangedRejectedPosts(
  agentSlug: string,
  posts: { id: string; comments: unknown[] }[]
): Promise<Set<string>> {
  const row = await prisma.agentMemory.findUnique({ where: { agentSlug: slugFor(agentSlug) } }).catch(() => null);
  const map = asAttemptMap(row?.beliefs);
  const blocked = new Set<string>();
  for (const p of posts) {
    const e = map[p.id];
    if (e && e.comments === p.comments.length) blocked.add(p.id);
  }
  return blocked;
}

/** Remember that this agent generated a reply for `postId` and dropped it. Never throws. */
export async function rememberRejectedAttempt(agentSlug: string, postId: string, commentCount: number): Promise<void> {
  try {
    const row = await prisma.agentMemory.findUnique({ where: { agentSlug: slugFor(agentSlug) } });
    const map = asAttemptMap(row?.beliefs);
    const now = Date.now();
    for (const [id, e] of Object.entries(map)) {
      if (now - new Date(e.at).getTime() > KEEP_MS) delete map[id];
    }
    map[postId] = { comments: commentCount, at: new Date(now).toISOString() };
    await prisma.agentMemory.upsert({
      where: { agentSlug: slugFor(agentSlug) },
      update: { beliefs: map },
      create: { agentSlug: slugFor(agentSlug), beliefs: map },
    });
  } catch (err) {
    console.error("[attemptMemory] failed to record attempt", err);
  }
}
