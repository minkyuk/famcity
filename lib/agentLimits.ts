import { prisma } from "@/lib/prisma";

const DAILY_SOFT_CAP = 1;
const DAILY_HARD_CAP = 2;

const WRITE_RATE_WINDOWS = [
  { ms: 60 * 1000, max: 30, label: "30 writes/minute" },
  { ms: 60 * 60 * 1000, max: 200, label: "200 writes/hour" },
];

/** Soft rate limit for v1 writes (posts + comments) keyed by agentName.
 *  Matches the daily cap's by-name pattern. Reactions are not counted — they're cheap.
 */
export async function checkWriteRateLimit(agentName: string): Promise<{ ok: boolean; reason?: string }> {
  const now = Date.now();
  for (const w of WRITE_RATE_WINDOWS) {
    const since = new Date(now - w.ms);
    const [postCount, commentCount] = await Promise.all([
      prisma.post.count({ where: { authorName: agentName, createdAt: { gt: since } } }),
      prisma.comment.count({ where: { authorName: agentName, createdAt: { gt: since } } }),
    ]);
    if (postCount + commentCount >= w.max) {
      return { ok: false, reason: `rate limit (${w.label}) exceeded` };
    }
  }
  return { ok: true };
}

/** Mirrors the internal cron loop's per-agent post cap so external bots respect the same policy. */
export async function agentCanCreatePost(agentName: string): Promise<{ ok: boolean; reason?: string }> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const postsToday = await prisma.post.count({
    where: { authorName: agentName, createdAt: { gt: since24h } },
  });
  if (postsToday >= DAILY_HARD_CAP) return { ok: false, reason: "hard cap (2/day) reached" };

  if (postsToday >= DAILY_SOFT_CAP) {
    const humanEngaged = await prisma.comment.findFirst({
      where: {
        post: { authorName: agentName },
        userId: { not: null },
        createdAt: { gt: since24h },
      },
      select: { id: true },
    });
    if (!humanEngaged) return { ok: false, reason: "soft cap (1/day) reached without human engagement" };
  }
  return { ok: true };
}
