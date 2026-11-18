import { AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";
import { AGENTS } from "@/lib/agents";
import { HELPER_NAMES } from "@/lib/devotional";
import { prisma } from "@/lib/prisma";
import { applyUpdate, emptySketch, laterOf, NOTHING_TO_ADD, parseSketchUpdate, sketchUpdatePrompt, type Scope, type Writing } from "@/lib/userSketch";
import { loadSketchRows, saveSketchIfUnchanged, type SketchRow } from "@/lib/userSketchStore";

/**
 * The hourly build of per-person memory. For a few people who have written something new since
 * their sketch was last updated, it reads ONLY what they wrote — their own non-private posts and
 * comments — and asks one small model call what to add.
 *
 * Never read: agent comments, other people's words, direct messages, chat, private posts.
 */

const SWEEP_SLUG = "$$sketch-sweep";
/** The cron ticks every five minutes; this keeps the sweep to one run an hour even if it is triggered twice. */
const MIN_GAP_MS = 50 * 60 * 1000;
/** People updated per sweep — a family catches up within a few hours without a burst of calls. */
const USERS_PER_SWEEP = 4;
/**
 * Messages read in one update; a first build reads a little further back. When someone writes
 * more than this between two sweeps, the newest are read and the older ones are passed over.
 */
const BATCH = 40;
const FIRST_BATCH = 60;
/** After this many unreadable answers for the same messages they are skipped rather than retried forever. */
const MAX_FAILS = 3;

const topicOf = (content: string | null) => (content ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "(a post without text)";
/** A members-only space is a scope of its own; system spaces and space-less posts are open to the whole family. */
const scopeOf = (post: { spaceId: string | null; space: { isSystem: boolean } | null }): Scope =>
  post.spaceId && !post.space?.isSystem ? post.spaceId : null;

/** Names of every agent: the knights and the agents people created in spaces. */
async function agentNames(): Promise<Set<string>> {
  const spaceAgents = await prisma.spaceAgent.findMany({ select: { name: true } }).catch(() => []);
  return new Set([...AGENTS.map((a) => a.name), ...spaceAgents.map((a) => a.name), ...HELPER_NAMES]);
}

/**
 * What one person wrote after `since`, oldest first — never more than `limit` of the newest.
 * `newestAt` is the time of their newest message of any length, so that a run of messages too
 * short to learn from ("ㅎㅎ", "👍") still moves the watermark.
 */
export async function writingsOf(
  userId: string,
  since: Date | null,
  limit: number,
  agents: Set<string>,
): Promise<{ writings: Writing[]; newestAt: Date | null }> {
  const after = since ? { createdAt: { gt: since } } : {};
  const [comments, posts] = await Promise.all([
    prisma.comment.findMany({
      where: { userId, ...after, post: { isPrivate: false } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        body: true,
        createdAt: true,
        postId: true,
        parent: { select: { authorName: true, userId: true } },
        post: { select: { content: true, authorName: true, userId: true, spaceId: true, space: { select: { isSystem: true } } } },
      },
    }),
    prisma.post.findMany({
      where: { userId, isPrivate: false, ...after },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, content: true, createdAt: true, spaceId: true, space: { select: { isSystem: true } } },
    }),
  ]);

  const all: Writing[] = [
    ...comments.map((c): Writing => {
      // The post may be kept and shown as context only when it is the person's own, or an agent's
      // (a Den question, a news item) — an agent being a post with no user AND a known agent name:
      // old posts from before sign-in also have no user, and those are a person's words.
      const mayShow = c.post.userId === userId || (c.post.userId === null && agents.has(c.post.authorName));
      const shownTopic = mayShow ? topicOf(c.post.content) : null;
      return {
        kind: "comment",
        text: c.body,
        at: c.createdAt,
        scope: scopeOf(c.post),
        postId: c.postId,
        topic: shownTopic ?? `a post by ${c.post.authorName}`,
        shownTopic,
        with: [
          ...new Set([...(c.post.userId !== userId ? [c.post.authorName] : []), ...(c.parent && c.parent.userId !== userId ? [c.parent.authorName] : [])]),
        ],
      };
    }),
    ...posts.map(
      (p): Writing => ({ kind: "post", text: p.content ?? "", at: p.createdAt, scope: scopeOf(p), postId: p.id, topic: topicOf(p.content), shownTopic: null, with: [] }),
    ),
  ];
  const newestAt = all.reduce<Date | null>((max, w) => (max === null || w.at > max ? w.at : max), null);
  const writings = all
    .filter((w) => w.text.trim().length >= 3)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-limit);
  return { writings, newestAt };
}

type Outcome = "updated" | "nothing-new" | "failed" | "reset-meanwhile";

/**
 * Updates one person's sketch from what they wrote since it was last read.
 * Every write is conditional on the row not having changed since it was loaded, so a reset that
 * lands while the model is working is never overwritten.
 */
export async function updateSketchFor(userId: string, name: string, row: SketchRow | null, agents: Set<string>): Promise<Outcome> {
  const sketch = { ...(row?.sketch ?? emptySketch(name)), ...(name ? { name } : {}) };
  const expected = row?.updatedAt ?? null;
  // Never read anything from before a reset, whatever the watermark says.
  const sinceIso = laterOf(sketch.watermark, sketch.resetAt);
  const { writings, newestAt } = await writingsOf(userId, sinceIso ? new Date(sinceIso) : null, row?.sketch.builtAt ? BATCH : FIRST_BATCH, agents);

  if (writings.length === 0) {
    // Only messages too short to learn from: mark them read so this person doesn't keep a place in every sweep.
    if (newestAt) await saveSketchIfUnchanged(userId, { ...sketch, watermark: laterOf(sinceIso, newestAt.toISOString()) }, expected);
    return "nothing-new";
  }

  let raw: string;
  try {
    const msg = await anthropicFor("sketch:update").messages.create({
      ...AGENT_REQUEST,
      max_tokens: 1000,
      messages: [{ role: "user", content: sketchUpdatePrompt(sketch, writings) }],
    });
    raw = textOf(msg);
  } catch {
    // An outage (billing, rate limit, server error) says nothing about these messages: leave
    // everything as it is and read the same batch at the next sweep.
    return "failed";
  }

  const additions = parseSketchUpdate(raw, writings);
  if (!additions) {
    // The model answered, but not with something readable. Count it against this batch; after a
    // few tries the batch is passed over (the threads joined are still recorded, nothing else).
    const batch = writings[writings.length - 1].at.toISOString();
    const fails = sketch.failBatch === batch ? sketch.fails + 1 : 1;
    const next = fails >= MAX_FAILS ? applyUpdate(sketch, NOTHING_TO_ADD, writings, new Date()) : { ...sketch, fails, failBatch: batch };
    return (await saveSketchIfUnchanged(userId, next, expected)) ? "failed" : "reset-meanwhile";
  }

  return (await saveSketchIfUnchanged(userId, applyUpdate(sketch, additions, writings, new Date()), expected)) ? "updated" : "reset-meanwhile";
}

/**
 * Takes this hour's turn, atomically: the marker row is only updated if it is old enough, so two
 * cron invocations arriving together cannot both run.
 */
async function claimSweep(now: Date): Promise<boolean> {
  const beliefs = { lastRunAt: now.toISOString() };
  const claimed = await prisma.agentMemory.updateMany({
    where: { agentSlug: SWEEP_SLUG, updatedAt: { lt: new Date(now.getTime() - MIN_GAP_MS) } },
    data: { beliefs },
  });
  if (claimed.count > 0) return true;
  try {
    await prisma.agentMemory.create({ data: { agentSlug: SWEEP_SLUG, beliefs } }); // first run ever
    return true;
  } catch {
    return false; // the marker exists and is recent: a sweep already ran
  }
}

export type SweepReport = { ran: boolean; reason?: string; updated: string[]; failed: string[] };

/**
 * One sweep: the people with the newest unread writing first. Safe to call on every cron tick —
 * it does nothing if a sweep ran within the last fifty minutes.
 */
export async function runSketchSweep(now = new Date()): Promise<SweepReport> {
  if (!(await claimSweep(now))) return { ran: false, reason: "ran recently", updated: [], failed: [] };

  // Newest non-private writing per person (posts and comments).
  const [byComment, byPost] = await Promise.all([
    prisma.comment.groupBy({ by: ["userId"], where: { userId: { not: null }, post: { isPrivate: false } }, _max: { createdAt: true } }),
    prisma.post.groupBy({ by: ["userId"], where: { userId: { not: null }, isPrivate: false }, _max: { createdAt: true } }),
  ]);
  const latest = new Map<string, Date>();
  for (const row of [...byComment, ...byPost]) {
    const at = row._max.createdAt;
    if (!row.userId || !at) continue;
    const seen = latest.get(row.userId);
    if (!seen || at > seen) latest.set(row.userId, at);
  }
  if (latest.size === 0) return { ran: true, updated: [], failed: [] };

  const ids = [...latest.keys()];
  const [rows, users, agents] = await Promise.all([
    loadSketchRows(ids),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    agentNames(),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? ""]));

  const due = [...latest.entries()]
    .filter(([id, at]) => {
      if (!nameOf.has(id)) return false; // the account is gone
      const sketch = rows.get(id)?.sketch;
      const read = sketch ? laterOf(sketch.watermark, sketch.resetAt) : null;
      return !read || at > new Date(read);
    })
    .sort((a, b) => b[1].getTime() - a[1].getTime())
    .slice(0, USERS_PER_SWEEP)
    .map(([id]) => id);

  const report: SweepReport = { ran: true, updated: [], failed: [] };
  for (const id of due) {
    const outcome = await updateSketchFor(id, nameOf.get(id) ?? "", rows.get(id) ?? null, agents).catch((): Outcome => "failed");
    if (outcome === "updated") report.updated.push(id);
    if (outcome === "failed") report.failed.push(id);
  }
  return report;
}
