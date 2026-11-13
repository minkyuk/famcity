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
 * GET — machine-readable version of the /admin/agents dashboard, for monitoring without a browser.
 * Auth: CRON_SECRET (x-cron-secret header / Bearer, same as the crons) or an admin session.
 * Read-only, except `?ping=1`, which also sends one 1-token live request (fraction of a cent).
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
