import type { Session } from "next-auth";

/**
 * Returns true if the user is a site admin.
 * Set ADMIN_EMAILS in Vercel env vars as a comma-separated list of email addresses.
 * e.g. ADMIN_EMAILS=you@gmail.com,spouse@gmail.com
 */
export function isAdmin(session: Session | null): boolean {
  if (!session?.user?.email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(session.user.email.toLowerCase());
}
