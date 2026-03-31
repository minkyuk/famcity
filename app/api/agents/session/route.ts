import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cronAuth";
import { isAdmin } from "@/lib/admin";

const SESSION_SLUG = "$$session";

/** GET — check whether a discussion session is currently active */
export async function GET(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const record = await prisma.agentMemory.findUnique({ where: { agentSlug: SESSION_SLUG } });
    if (!record) return NextResponse.json({ active: false });

    const data = record.beliefs as { startedAt?: string; durationMinutes?: number };
    if (!data?.startedAt) return NextResponse.json({ active: false });

    const startedAt = new Date(data.startedAt);
    const durationMs = (data.durationMinutes ?? 60) * 60 * 1000;
    const elapsed = Date.now() - startedAt.getTime();
    const active = elapsed < durationMs;
    const remainingMinutes = active ? Math.ceil((durationMs - elapsed) / 60_000) : 0;

    return NextResponse.json({ active, startedAt: data.startedAt, remainingMinutes });
  } catch {
    return NextResponse.json({ active: false });
  }
}

const FIRE_COST = 1000;

/** POST — start a 25-min discussion session */
export async function POST(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!isCronAuthorized(req)) {
    if (!authSession?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = authSession ? isAdmin(authSession) : false;

  const url = new URL(req.url);
  const durationMinutes = Math.min(parseInt(url.searchParams.get("minutes") ?? "25", 10) || 25, 180);

  // Check and deduct credits (admins pay nothing, cron pays nothing)
  if (authSession?.user && !admin) {
    const user = await prisma.user.findUnique({
      where: { id: authSession.user.id },
      select: { credits: true },
    });
    if (!user || user.credits < FIRE_COST) {
      return NextResponse.json({ error: `Not enough credits (need ${FIRE_COST})` }, { status: 402 });
    }
  }

  try {
    await prisma.agentMemory.upsert({
      where: { agentSlug: SESSION_SLUG },
      update: { beliefs: { startedAt: new Date().toISOString(), durationMinutes } },
      create: { agentSlug: SESSION_SLUG, beliefs: { startedAt: new Date().toISOString(), durationMinutes } },
    });
    if (authSession?.user && !admin) {
      await prisma.user.update({
        where: { id: authSession.user.id },
        data: { credits: { decrement: FIRE_COST } },
      });
    }
    return NextResponse.json({ ok: true, durationMinutes });
  } catch {
    return NextResponse.json({ error: "Failed to start session — run Prisma migration first" }, { status: 500 });
  }
}

/** DELETE — end the session early */
export async function DELETE(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!isCronAuthorized(req)) {
    if (!authSession?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(authSession)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await prisma.agentMemory.delete({ where: { agentSlug: SESSION_SLUG } });
  } catch {
    // already gone — that's fine
  }
  return NextResponse.json({ ok: true, message: "Session ended" });
}
