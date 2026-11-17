import { AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";
import { applyUpdate, emptySketch, parseSketchUpdate, sketchUpdatePrompt, type Scope, type UserSketch, type Writing } from "@/lib/userSketch";
import { loadSketch, loadSketches, saveSketch } from "@/lib/userSketchStore";

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
/** Messages read in one update; a first build reads a little further back. */
const BATCH = 40;
const FIRST_BATCH = 60;
/** After this many failed tries on the same messages they are skipped rather than retried forever. */
const MAX_FAILS = 3;

const topicOf = (content: string | null) => (content ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "(a post without text)";
/** A members-only space is a scope of its own; system spaces and space-less posts are open to the whole family. */
const scopeOf = (post: { spaceId: string | null; space: { isSystem: boolean } | null }): Scope => (post.spaceId && !post.space?.isSystem ? post.spaceId : null);

/** What one person wrote after `since`, oldest first — never more than `limit` of the newest. */
export async function writingsOf(userId: string, since: Date | null, limit: number): Promise<Writing[]> {
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

  const writings: Writing[] = [
    ...comments.map((c): Writing => {
      // An agent's post (a Den question, a news item) or the person's own may be kept and shown as
      // context. Another family member's post is theirs: only "a post by <name>" goes into this sketch.
      const shownTopic = c.post.userId === null || c.post.userId === userId ? topicOf(c.post.content) : null;
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
      (p): Writing => ({
        kind: "post",
        text: p.content ?? "",
        at: p.createdAt,
        scope: scopeOf(p),
        postId: p.id,
        topic: topicOf(p.content),
        shownTopic: null,
        with: [],
      }),
    ),
  ];
  return writings
    .filter((w) => w.text.trim().length >= 3)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-limit);
}

/** Updates one person's sketch from what they wrote since it was last read. Returns what happened. */
export async function updateSketchFor(
  userId: string,
  name: string,
  existing: UserSketch | null,
): Promise<"updated" | "nothing-new" | "failed" | "reset-meanwhile"> {
  const sketch = existing ?? emptySketch(name);
  if (name && sketch.name !== name) sketch.name = name;
  const since = sketch.watermark ? new Date(sketch.watermark) : null;
  const writings = await writingsOf(userId, since, existing?.builtAt ? BATCH : FIRST_BATCH);
  if (writings.length === 0) return "nothing-new";

  let raw = "";
  try {
    const msg = await anthropicFor("sketch:update").messages.create({
      ...AGENT_REQUEST,
      max_tokens: 1000,
      messages: [{ role: "user", content: sketchUpdatePrompt(sketch, writings) }],
    });
    raw = textOf(msg);
  } catch {
    raw = "";
  }
  const readable = /\{[\s\S]*\}/.test(raw);

  // The person may have cleared their sketch while the model was thinking: their reset wins.
  const current = await loadSketch(userId);
  if ((current?.resetAt ?? null) !== sketch.resetAt) return "reset-meanwhile";

  if (!readable) {
    const fails = sketch.fails + 1;
    // Give up on this batch after a few tries: the threads joined are still recorded, nothing else.
    const next = fails >= MAX_FAILS ? applyUpdate(sketch, { character: [], ideas: [], memories: [], mood: null }, writings, new Date()) : { ...sketch, fails };
    await saveSketch(userId, next);
    return "failed";
  }

  await saveSketch(userId, applyUpdate(sketch, parseSketchUpdate(raw, writings), writings, new Date()));
  return "updated";
}

export type SweepReport = { ran: boolean; reason?: string; updated: string[]; failed: string[] };

/**
 * One sweep: the people with the newest unread writing first. Safe to call on every cron tick —
 * it does nothing if a sweep ran within the last fifty minutes.
 */
export async function runSketchSweep(now = new Date()): Promise<SweepReport> {
  const marker = await prisma.agentMemory.findUnique({ where: { agentSlug: SWEEP_SLUG }, select: { beliefs: true } });
  const last = (marker?.beliefs as { lastRunAt?: string } | null)?.lastRunAt; // our own marker row: { lastRunAt }
  if (last && now.getTime() - new Date(last).getTime() < MIN_GAP_MS) return { ran: false, reason: "ran recently", updated: [], failed: [] };
  await prisma.agentMemory.upsert({
    where: { agentSlug: SWEEP_SLUG },
    create: { agentSlug: SWEEP_SLUG, beliefs: { lastRunAt: now.toISOString() } },
    update: { beliefs: { lastRunAt: now.toISOString() } },
  });

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
  const [sketches, users] = await Promise.all([loadSketches(ids), prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })]);
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? ""]));

  const due = [...latest.entries()]
    .filter(([id, at]) => {
      if (!nameOf.has(id)) return false; // the account is gone
      const watermark = sketches.get(id)?.watermark;
      return !watermark || at > new Date(watermark);
    })
    .sort((a, b) => b[1].getTime() - a[1].getTime())
    .slice(0, USERS_PER_SWEEP)
    .map(([id]) => id);

  const report: SweepReport = { ran: true, updated: [], failed: [] };
  for (const id of due) {
    const outcome = await updateSketchFor(id, nameOf.get(id) ?? "", sketches.get(id) ?? null).catch(() => "failed" as const);
    if (outcome === "updated") report.updated.push(id);
    if (outcome === "failed") report.failed.push(id);
  }
  return report;
}
