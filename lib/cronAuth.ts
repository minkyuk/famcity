import { NextRequest } from "next/server";

/**
 * Returns true if the request is authorized as a cron job.
 * Accepts Vercel's automatic `Authorization: Bearer <CRON_SECRET>` header
 * or a manual `x-cron-secret` / `?secret=` for local testing.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const header = req.headers.get("x-cron-secret");
  if (header === secret) return true;

  const query = req.nextUrl.searchParams.get("secret");
  if (query === secret) return true;

  return false;
}
