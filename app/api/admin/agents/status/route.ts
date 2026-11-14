import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { isCronAuthorized } from "@/lib/cronAuth";
import { loadAiHealth } from "@/lib/aiHealth";
import { pingAgentModel } from "@/lib/aiPing";
import { loadDailyActivity } from "@/lib/activityHistory";
import { AgentStatusQuerySchema } from "@/lib/validators";

/**
 * Why a monitoring request was refused, so a broken setup can be diagnosed without guessing.
 * Says only which side is wrong — never anything about the secret's value.
 */
function forbiddenReason(req: NextRequest): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "server_has_no_CRON_SECRET (set it in Vercel and redeploy)";
  const sent = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!sent) return "no_secret_sent (no x-cron-secret / Bearer header reached the server)";
  if (sent.trim() === secret.trim()) return "secret_matches_except_whitespace (re-save it without spaces/newlines)";
  return "secret_mismatch (sent value differs from the deployed CRON_SECRET — re-copy it, or redeploy after changing it)";
}

/**
 * GET — machine-readable version of the /admin/agents dashboard, for monitoring without a browser.
 * Auth: CRON_SECRET (x-cron-secret header / Bearer, same as the crons) or an admin session.
 * Read-only, except `?ping=1`, which also sends one 1-token live request (fraction of a cent).
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Forbidden", reason: forbiddenReason(req) }, { status: 403 });
    }
  }

  const parsed = AgentStatusQuerySchema.safeParse({ ping: req.nextUrl.searchParams.get("ping") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 });

  const [health, ping, dailyActivity] = await Promise.all([
    loadAiHealth(),
    parsed.data.ping ? pingAgentModel() : Promise.resolve(null),
    loadDailyActivity().catch(() => []),
  ]);
  return NextResponse.json({ checkedAt: new Date().toISOString(), ping, health, dailyActivity });
}
