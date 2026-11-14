import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { isCronAuthorized, presentedCronSecret } from "@/lib/cronAuth";
import { loadAiHealth } from "@/lib/aiHealth";
import { pingAgentModel } from "@/lib/aiPing";
import { loadDailyActivity } from "@/lib/activityHistory";
import { AgentStatusQuerySchema } from "@/lib/validators";

/**
 * Why a monitoring request was refused, so a broken setup can be diagnosed without guessing.
 * Says only which side is wrong — never anything about the secret's value.
 */
function forbiddenReason(req: NextRequest): string {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return "server_has_no_CRON_SECRET (set it in Vercel and redeploy)";
  const sent = presentedCronSecret(req);
  if (!sent) return "no_secret_sent (no x-cron-secret / Bearer header reached the server)";
  // Phones auto-capitalise the first letter of a one-word secret typed into a form.
  if (sent.toLowerCase() === secret.toLowerCase()) return "matches_except_letter_case (check capital letters, e.g. an auto-capitalised first letter)";
  if (sent.startsWith(secret)) return "sent_has_extra_text_after_the_secret (copied too much)";
  if (secret.startsWith(sent)) return "sent_is_cut_short (only part of the secret was copied)";
  if (sent.includes(secret)) {
    // Describe the extra text by character class only, never its content.
    const [pre, post] = sent.split(secret);
    const kind = (s: string) =>
      !s ? "none" : /^[\s"'`“”‘’]+$/.test(s) ? "quotes/spaces" : /^[A-Za-z_\-]+\s*[:=]?\s*$/.test(s) ? "a label word" : "other characters";
    return `sent_has_extra_text_around_the_secret (before: ${kind(pre)}, after: ${kind(post ?? "")})`;
  }
  return "different_value (not the deployed CRON_SECRET — check you copied CRON_SECRET from the famcity project)";
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
      return NextResponse.json(
        // `build` says which deploy answered, so a stale deployment can't be mistaken for a bad secret.
        { error: "Forbidden", reason: forbiddenReason(req), build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
        { status: 403 }
      );
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
