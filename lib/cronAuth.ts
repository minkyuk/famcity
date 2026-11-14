import { NextRequest } from "next/server";

/**
 * Normalise a presented secret: trim whitespace/newlines and drop an auth-scheme word
 * ("Bearer ", "Token ") that a credential form or proxy may have put in front of it.
 * The secret itself must still match exactly — this only removes packaging.
 */
export function normalizePresentedSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim().replace(/^(Bearer|Token)\s+/i, "").trim();
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
