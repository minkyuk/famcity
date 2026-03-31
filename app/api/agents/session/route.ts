import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cronAuth";

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

/** POST — start a 1-hour discussion session (or custom duration via ?minutes=N) */
export async function POST(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const durationMinutes = Math.min(parseInt(url.searchParams.get("minutes") ?? "60", 10) || 60, 180);

  try {
    await prisma.agentMemory.upsert({
      where: { agentSlug: SESSION_SLUG },
      update: { beliefs: { startedAt: new Date().toISOString(), durationMinutes } },
      create: { agentSlug: SESSION_SLUG, beliefs: { startedAt: new Date().toISOString(), durationMinutes } },
    });
    return NextResponse.json({ ok: true, durationMinutes, message: `Discussion session started for ${durationMinutes} minutes` });
  } catch {
    return NextResponse.json({ error: "Failed to start session — run Prisma migration first" }, { status: 500 });
  }
}

/** DELETE — end the session early */
export async function DELETE(req: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.agentMemory.delete({ where: { agentSlug: SESSION_SLUG } });
  } catch {
    // already gone — that's fine
  }
  return NextResponse.json({ ok: true, message: "Session ended" });
}
