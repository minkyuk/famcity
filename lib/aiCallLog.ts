import { prisma } from "@/lib/prisma";

/**
 * Why a Claude API call failed, in terms an admin can act on.
 *  billing      → out of credits / payment problem (402, or the legacy 400 "credit balance is too low")
 *  rate_limit   → 429: too many requests, or the org's monthly spend limit was reached
 *  auth         → 401/403: API key missing, revoked, or lacks permission
 *  not_found    → 404: usually the model ID was retired or mistyped
 *  overloaded   → 529: Anthropic is temporarily overloaded (SDK retries automatically)
 *  server       → other 5xx on Anthropic's side
 *  invalid_request → other 400s (a bug in our request)
 *  network      → the request never got a response (DNS, timeout, connection reset)
 */
export type AiErrorType =
  | "billing"
  | "rate_limit"
  | "auth"
  | "not_found"
  | "overloaded"
  | "server"
  | "invalid_request"
  | "network"
  | "other";

export type AiCallRecord = {
  route: string;
  model: string | null;
  ok: boolean;
  status: number | null;
  errorType: AiErrorType | null;
  errorMessage: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
  /** Agent whose turn made the call (from withAgent()), null outside an agent turn. */
  agent: string | null;
};

/** Classify an API error from its HTTP status and the `error.type` field of the response body. */
export function classifyAiError(status: number, apiType: string | null, message: string | null): AiErrorType {
  if (status === 402 || apiType === "billing_error") return "billing";
  // Older API behaviour: an exhausted balance came back as a 400 invalid_request_error whose only
  // distinguishing signal is the message text, so this one case has to look at the message.
  if (status === 400 && message && /credit balance/i.test(message)) return "billing";
  if (status === 429 || apiType === "rate_limit_error") return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 529 || apiType === "overloaded_error") return "overloaded";
  if (status >= 500) return "server";
  if (status === 400) return "invalid_request";
  return "other";
}

// Exact DDL for the AiCallLog model, generated with
// `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`.
// Kept identical to what `prisma db push` would create so a later push sees no drift.
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "AiCallLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT NOT NULL,
    "model" TEXT,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "agent" TEXT,

    CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
)`;
// Added after the table first shipped; existing tables get the column here (same type db push would use).
const ADD_AGENT_COLUMN_SQL = `ALTER TABLE "AiCallLog" ADD COLUMN IF NOT EXISTS "agent" TEXT`;
const CREATE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS "AiCallLog_createdAt_idx" ON "AiCallLog"("createdAt")`;

let tableReady: Promise<void> | null = null;

/** Create the AiCallLog table if it doesn't exist yet (once per server instance). */
export function ensureAiCallLogTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
      await prisma.$executeRawUnsafe(ADD_AGENT_COLUMN_SQL);
      await prisma.$executeRawUnsafe(CREATE_INDEX_SQL);
    })().catch((err: unknown) => {
      tableReady = null; // retry on the next call
      throw err;
    });
  }
  return tableReady;
}

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Persist one call. Never throws — logging must not break an agent turn. */
export async function recordAiCall(rec: AiCallRecord): Promise<void> {
  try {
    await ensureAiCallLogTable();
    await prisma.aiCallLog.create({
      data: { ...rec, errorMessage: rec.errorMessage?.slice(0, 500) ?? null },
    });
  } catch (err) {
    console.error("[aiCallLog] failed to record call", err);
  }
}

/** Delete rows past the retention window. Called from the dashboard load, never from an agent turn. */
export async function pruneAiCallLog(): Promise<void> {
  await prisma.aiCallLog
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } })
    .catch((err: unknown) => console.error("[aiCallLog] prune failed", err));
}

// ── Cron heartbeat ──────────────────────────────────────────────────────────
// Stored in AgentMemory under reserved "$$heartbeat:<route>:<trigger>" slugs, like other $$ rows.
// Cron and user-triggered runs are kept separate so frequent user triggers can't hide a dead cron.

export type HeartbeatRoute = "discuss" | "news";
export type HeartbeatTrigger = "cron" | "user";

const heartbeatSlug = (route: HeartbeatRoute, trigger: HeartbeatTrigger) => `$$heartbeat:${route}:${trigger}`;

export async function recordHeartbeat(route: HeartbeatRoute, trigger: HeartbeatTrigger): Promise<void> {
  const beat = { at: new Date().toISOString() };
  try {
    await prisma.agentMemory.upsert({
      where: { agentSlug: heartbeatSlug(route, trigger) },
      update: { beliefs: beat },
      create: { agentSlug: heartbeatSlug(route, trigger), beliefs: beat },
    });
  } catch (err) {
    console.error("[aiCallLog] failed to record heartbeat", err);
  }
}

/** Time of the last run for this route + trigger, or null if never recorded. */
export async function readHeartbeat(route: HeartbeatRoute, trigger: HeartbeatTrigger): Promise<Date | null> {
  const row = await prisma.agentMemory
    .findUnique({ where: { agentSlug: heartbeatSlug(route, trigger) } })
    .catch(() => null);
  const b = row?.beliefs;
  if (b && typeof b === "object" && !Array.isArray(b) && typeof b.at === "string") return new Date(b.at);
  return null;
}
