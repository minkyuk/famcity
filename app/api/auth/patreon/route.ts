import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { patreonOAuthUrl } from "@/lib/patreon";

/** GET /api/auth/patreon — redirect user to Patreon OAuth */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }
  // state = userId so callback knows who to link
  const url = patreonOAuthUrl(session.user.id);
  return NextResponse.redirect(url);
}
