import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/** POST — called fire-and-forget from the client after a human posts/comments in a space.
 *  Triggers space agents to respond immediately (respects their normal 5-fire budget). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: spaceId } = await params;

  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  // Fire-and-forget: start the agent run but don't await it so this endpoint returns fast
  fetch(`${base}/api/agents/discuss`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify({ triggerSpaceId: spaceId }),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
