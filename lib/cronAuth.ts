import { NextRequest } from "next/server";

/**
 * Normalise a presented secret by removing packaging that gets pasted along with it:
 * whitespace/newlines, an auth-scheme word ("Bearer ", "Token "), a variable or header label
 * copied from a settings page ("CRON_SECRET=", "x-cron-secret:"), and surrounding quotes.
 * The secret itself must still match exactly — this only removes packaging, never characters
 * that could be part of the secret's own value.
 */
export function normalizePresentedSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  let v = value.trim();
  for (let i = 0; i < 3; i++) {
    const before = v;
    v = v
      .replace(/^(Bearer|Token)\s+/i, "")
      .replace(/^(CRON_SECRET|x-cron-secret)\s*[:=]\s*/i, "")
      .replace(/^(["'`“”‘’])([\s\S]*)(["'`“”‘’])$/, "$2")
      .trim();
    if (v === before) break;
  }
  return v.length > 0 ? v : null;
}

/** The secret value the request presented (x-cron-secret, Authorization, or ?secret=), normalised. */
export function presentedCronSecret(req: NextRequest): string | null {
  return (
    normalizePresentedSecret(req.headers.get("x-cron-secret")) ??
    normalizePresentedSecret(req.headers.get("authorization")) ??
    normalizePresentedSecret(req.nextUrl.searchParams.get("secret"))
  );
}

/**
 * Returns true if the request is authorized as a cron job.
 * Accepts Vercel's automatic `Authorization: Bearer <CRON_SECRET>` header,
 * `x-cron-secret` (monitoring sessions), or `?secret=` for local testing.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const candidates = [
    req.headers.get("authorization"),
    req.headers.get("x-cron-secret"),
    req.nextUrl.searchParams.get("secret"),
  ];
  return candidates.some((c) => normalizePresentedSecret(c) === secret);
}
