import { prisma } from "@/lib/prisma";

export type DayActivity = {
  day: string; // YYYY-MM-DD (UTC, same as the Anthropic Console usage chart)
  agentComments: number;
  agentPosts: number;
  humanComments: number;
  humanPosts: number;
  firePurchases: number; // 🔥 global hot sessions bought with credits (admin-started ones aren't recorded)
  boltPurchases: number; // ⚡ space buzz bought with credits
};

type CountRow = { day: string; agent: number; human: number };
type BuyRow = { day: string; fire: number; bolt: number };

/**
 * Per-day activity for the last `days` days, newest first. Agents are authors with no user
 * account (userId IS NULL). Explains token spikes on days before AiCallLog existed.
 */
export async function loadDailyActivity(days = 21): Promise<DayActivity[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [comments, posts, buys] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             (COUNT(*) FILTER (WHERE "userId" IS NULL))::int AS agent,
             (COUNT(*) FILTER (WHERE "userId" IS NOT NULL))::int AS human
      FROM "Comment" WHERE "createdAt" >= ${since} GROUP BY 1`,
    prisma.$queryRaw<CountRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             (COUNT(*) FILTER (WHERE "userId" IS NULL))::int AS agent,
             (COUNT(*) FILTER (WHERE "userId" IS NOT NULL))::int AS human
      FROM "Post" WHERE "createdAt" >= ${since} GROUP BY 1`,
    prisma.$queryRaw<BuyRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             (COUNT(*) FILTER (WHERE reason = 'fire'))::int AS fire,
             (COUNT(*) FILTER (WHERE reason = 'bolt'))::int AS bolt
      FROM "CreditTransaction" WHERE "createdAt" >= ${since} GROUP BY 1`,
  ]);

  const byDay = new Map<string, DayActivity>();
  const get = (day: string): DayActivity => {
    let d = byDay.get(day);
    if (!d) {
      d = { day, agentComments: 0, agentPosts: 0, humanComments: 0, humanPosts: 0, firePurchases: 0, boltPurchases: 0 };
      byDay.set(day, d);
    }
    return d;
  };
  for (const r of comments) { const d = get(r.day); d.agentComments = r.agent; d.humanComments = r.human; }
  for (const r of posts) { const d = get(r.day); d.agentPosts = r.agent; d.humanPosts = r.human; }
  for (const r of buys) { const d = get(r.day); d.firePurchases = r.fire; d.boltPurchases = r.bolt; }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}
