import { prisma } from "@/lib/prisma";
import { AGENTS } from "@/lib/agents";
import { categoryOf, type TokenCategory } from "@/lib/tokenCategories";
import { ensureAiCallLogTable, pruneAiCallLog, readHeartbeat, type AiErrorType } from "@/lib/aiCallLog";

/** USD per million tokens (cache read 0.1×, 5-min cache write 1.25× of input).
 *  Haiku 5.5 is $0.10/$0.50 for prompts ≤100K tokens (agent prompts are far below that). */
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};
function priceFor(model: string | null) {
  if (!model) return null;
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  return key ? PRICING[key] : null;
}

export type HourBucket = { hoursAgo: number; ok: number; errors: number };

export type HealthStatus =
  | { kind: "healthy" }
  | { kind: "error"; errorType: AiErrorType; message: string; at: Date }
  | { kind: "cron_down"; lastBeat: Date | null }
  | { kind: "idle" };

export type AiHealth = {
  status: HealthStatus;
  calls24h: number;
  errors24h: number;
  errorsByType: { type: string; count: number }[];
  inputTokens24h: number;
  outputTokens24h: number;
  costUsd24h: number;
  unpricedCalls24h: number;
  lastSuccessAt: Date | null;
  hourly: HourBucket[];
  recentErrors: { at: Date; route: string; model: string | null; status: number | null; errorType: string | null; message: string | null }[];
  agentComments24h: number;
  agentPosts24h: number;
  lastAgentCommentAt: Date | null;
  cronDiscussAt: Date | null;
  userTriggerAt: Date | null;
  cronNewsAt: Date | null;
  tableError: string | null;
  /** Token spend per code path ("discuss:runDirectTurn", "news:vote", ...), biggest first. */
  byRoute: { route: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }[];
  /** Token spend per agent (gates included in the agent's turn), biggest first. */
  byAgent: { agent: string; calls: number; tokens: number; costUsd: number }[];
};

const HOUR = 60 * 60 * 1000;
/** The discuss cron is scheduled every 5 minutes; three missed ticks means it isn't running. */
const CRON_STALE_MS = 15 * 60 * 1000;
/** Routes whose failures mean "agents can't talk". A one-off 400 from translate/analyze shouldn't turn the banner red. */
const AGENT_ROUTE_PREFIXES = ["discuss", "news", "admin-ping"];
/** 529s are retried automatically; only flag them when nothing has succeeded for this long. */
const OVERLOAD_ALERT_MS = 60 * 60 * 1000;

export async function loadAiHealth(): Promise<AiHealth> {
  const now = Date.now();
  const since = new Date(now - 24 * HOUR);

  let tableError: string | null = null;
  await ensureAiCallLogTable().catch((err: unknown) => {
    tableError = err instanceof Error ? err.message : String(err);
  });
  if (!tableError) await pruneAiCallLog();

  const spaceAgentNames = (await prisma.spaceAgent.findMany({ select: { name: true } }).catch(() => [])).map((r) => r.name);
  const agentNames = [...AGENTS.map((a) => a.name), ...spaceAgentNames];

  const [logs, latest, lastSuccess, recentErrors, agentComments24h, agentPosts24h, lastAgentComment, cronDiscussAt, userTriggerAt, cronNewsAt] =
    await Promise.all([
      prisma.aiCallLog
        .findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true, route: true, agent: true, ok: true, errorType: true, model: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
        })
        .catch(() => []),
      prisma.aiCallLog
        .findFirst({
          where: { OR: AGENT_ROUTE_PREFIXES.map((r) => ({ route: { startsWith: r } })), createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
        })
        .catch(() => null),
      prisma.aiCallLog.findFirst({ where: { ok: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null),
      prisma.aiCallLog.findMany({ where: { ok: false }, orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
      // Agents never have a userId, so this excludes a human whose display name happens to match an agent.
      prisma.comment.count({ where: { authorName: { in: agentNames }, userId: null, createdAt: { gte: since } } }),
      prisma.post.count({ where: { authorName: { in: agentNames }, userId: null, createdAt: { gte: since } } }),
      prisma.comment.findFirst({ where: { authorName: { in: agentNames }, userId: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      readHeartbeat("discuss", "cron"),
      readHeartbeat("discuss", "user"),
      readHeartbeat("news", "cron"),
    ]);

  const hourly: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({ hoursAgo: 23 - i, ok: 0, errors: 0 }));
  const byType = new Map<string, number>();
  let inputTokens24h = 0, outputTokens24h = 0, costUsd24h = 0, unpricedCalls24h = 0, errors24h = 0;

  const routeAgg = new Map<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  const agentAgg = new Map<string, { calls: number; tokens: number; costUsd: number }>();
  for (const l of logs) {
    // Clamp both ends: clock skew between instances can put a row slightly in the future.
    const hoursAgo = Math.max(0, Math.min(23, Math.floor((now - l.createdAt.getTime()) / HOUR)));
    const bucket = hourly[23 - hoursAgo];
    if (l.ok) bucket.ok++; else { bucket.errors++; errors24h++; byType.set(l.errorType ?? "other", (byType.get(l.errorType ?? "other") ?? 0) + 1); }
    inputTokens24h += l.inputTokens;
    const agg = routeAgg.get(l.route) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    agg.calls++;
    agg.inputTokens += l.inputTokens;
    agg.outputTokens += l.outputTokens;
    const rp = priceFor(l.model);
    if (rp) agg.costUsd += (l.inputTokens * rp.input + l.outputTokens * rp.output + l.cacheReadTokens * rp.cacheRead + l.cacheWriteTokens * rp.cacheWrite) / 1e6;
    routeAgg.set(l.route, agg);
    const agentKey = l.agent ?? (l.route.startsWith("news") ? "뉴스 (에이전트 미상)" : "에이전트 아님 (번역·분석·테스트)");
    const aa = agentAgg.get(agentKey) ?? { calls: 0, tokens: 0, costUsd: 0 };
    aa.calls++;
    aa.tokens += l.inputTokens + l.outputTokens;
    if (rp) aa.costUsd += (l.inputTokens * rp.input + l.outputTokens * rp.output + l.cacheReadTokens * rp.cacheRead + l.cacheWriteTokens * rp.cacheWrite) / 1e6;
    agentAgg.set(agentKey, aa);
    outputTokens24h += l.outputTokens;
    const p = priceFor(l.model);
    if (p) {
      costUsd24h += (l.inputTokens * p.input + l.outputTokens * p.output + l.cacheReadTokens * p.cacheRead + l.cacheWriteTokens * p.cacheWrite) / 1e6;
    } else if (l.ok && l.inputTokens + l.outputTokens > 0) {
      unpricedCalls24h++;
    }
  }

  let status: HealthStatus;
  const lastSuccessMs = lastSuccess?.createdAt.getTime() ?? 0;
  const latestIsBlockingError =
    !!latest && !latest.ok && !!latest.errorType &&
    (latest.errorType !== "overloaded" || now - lastSuccessMs > OVERLOAD_ALERT_MS);
  if (latest && latestIsBlockingError && latest.errorType) {
    status = { kind: "error", errorType: latest.errorType as AiErrorType, message: latest.errorMessage ?? "", at: latest.createdAt }; // errorType column only ever holds AiErrorType values (written by recordAiCall)
  } else if (!cronDiscussAt || now - cronDiscussAt.getTime() > CRON_STALE_MS) {
    status = { kind: "cron_down", lastBeat: cronDiscussAt };
  } else if (logs.length === 0) {
    status = { kind: "idle" };
  } else {
    status = { kind: "healthy" };
  }

  return {
    status,
    calls24h: logs.length,
    errors24h,
    errorsByType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    inputTokens24h,
    outputTokens24h,
    costUsd24h,
    unpricedCalls24h,
    lastSuccessAt: lastSuccess?.createdAt ?? null,
    hourly,
    recentErrors: recentErrors.map((e) => ({ at: e.createdAt, route: e.route, model: e.model, status: e.status, errorType: e.errorType, message: e.errorMessage })),
    agentComments24h,
    agentPosts24h,
    lastAgentCommentAt: lastAgentComment?.createdAt ?? null,
    cronDiscussAt,
    userTriggerAt,
    cronNewsAt,
    tableError,
    byRoute: [...routeAgg.entries()]
      .map(([route, a]) => ({ route, ...a }))
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)),
    byAgent: [...agentAgg.entries()].map(([agent, a]) => ({ agent, ...a })).sort((a, b) => b.tokens - a.tokens),
  };
}

export type DailyTokens = { day: string; total: number; byCategory: Record<TokenCategory, number> };

type DayRouteRow = { day: string; route: string; tokens: number };

/** Tokens per UTC day for the last `days` days, split into TOKEN_CATEGORIES (oldest first). */
export async function loadDailyTokens(days = 14): Promise<DailyTokens[]> {
  await ensureAiCallLogTable();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<DayRouteRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, route,
           SUM("inputTokens" + "outputTokens")::int AS tokens
    FROM "AiCallLog" WHERE "createdAt" >= ${since} GROUP BY 1, 2`;
  const byDay = new Map<string, DailyTokens>();
  for (const r of rows) {
    let d = byDay.get(r.day);
    if (!d) {
      d = { day: r.day, total: 0, byCategory: { direct: 0, routine: 0, space: 0, gate: 0, news: 0, other: 0 } };
      byDay.set(r.day, d);
    }
    d.byCategory[categoryOf(r.route)] += r.tokens;
    d.total += r.tokens;
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}
