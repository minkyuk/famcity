import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

const DURATION_MINUTES = 3;
const COOLDOWN_MINUTES = 20;

function slug(spaceId: string) {
  return `$$space-session:${spaceId}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: spaceId } = await params;
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const record = await prisma.agentMemory.findUnique({ where: { agentSlug: slug(spaceId) } });
    if (!record) return NextResponse.json({ active: false, remainingSeconds: 0, cooldownRemainingSeconds: 0 });

    const data = record.beliefs as { startedAt?: string; durationMinutes?: number };
    if (!data?.startedAt) return NextResponse.json({ active: false, remainingSeconds: 0, cooldownRemainingSeconds: 0 });

    const elapsed = Date.now() - new Date(data.startedAt).getTime();
    const durationMs = (data.durationMinutes ?? DURATION_MINUTES) * 60 * 1000;
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

    const active = elapsed < durationMs;
    const remainingSeconds = active ? Math.ceil((durationMs - elapsed) / 1000) : 0;
    const cooldownRemainingSeconds = elapsed < cooldownMs ? Math.ceil((cooldownMs - elapsed) / 1000) : 0;

    return NextResponse.json({ active, remainingSeconds, cooldownRemainingSeconds });
  } catch {
    return NextResponse.json({ active: false, remainingSeconds: 0, cooldownRemainingSeconds: 0 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: spaceId } = await params;
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = isAdmin(authSession);
  const BOLT_COST = 10;
  const userId = authSession.user.id;

  // Reject if within cooldown (admins bypass)
  if (!admin) {
    try {
      const record = await prisma.agentMemory.findUnique({ where: { agentSlug: slug(spaceId) } });
      if (record) {
        const data = record.beliefs as { startedAt?: string };
        if (data?.startedAt) {
          const elapsed = Date.now() - new Date(data.startedAt).getTime();
          if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
            const m = Math.ceil((COOLDOWN_MINUTES * 60 * 1000 - elapsed) / 60_000);
            return NextResponse.json({ error: `Cooldown active — ${m}m remaining` }, { status: 429 });
          }
        }
      }
    } catch {}
  }

  const startedAt = new Date().toISOString();
  const sessionPayload = { startedAt, durationMinutes: DURATION_MINUTES };

  // Non-admin: deduct credits and activate session in a single atomic transaction
  if (!admin) {
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
        if (!user || user.credits < BOLT_COST) throw new Error("insufficient_credits");
        await tx.user.update({ where: { id: userId }, data: { credits: { decrement: BOLT_COST } } });
        await tx.creditTransaction.create({ data: { userId, amount: -BOLT_COST, reason: "bolt", spaceId } });
        await tx.agentMemory.upsert({
          where: { agentSlug: slug(spaceId) },
          update: { beliefs: sessionPayload },
          create: { agentSlug: slug(spaceId), beliefs: sessionPayload },
        });
      });
    } catch (e) {
      if ((e as Error).message === "insufficient_credits") {
        return NextResponse.json({ error: `Not enough credits (need ${BOLT_COST})` }, { status: 402 });
      }
      return NextResponse.json({ error: "Failed to start session" }, { status: 500 });
    }
  } else {
    // Admin — no credit charge
    await prisma.agentMemory.upsert({
      where: { agentSlug: slug(spaceId) },
      update: { beliefs: sessionPayload },
      create: { agentSlug: slug(spaceId), beliefs: sessionPayload },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: spaceId } = await params;
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Keep startedAt for cooldown tracking, set durationMinutes: 0 to end session immediately
  try {
    const record = await prisma.agentMemory.findUnique({ where: { agentSlug: slug(spaceId) } });
    if (record) {
      const data = record.beliefs as { startedAt?: string };
      await prisma.agentMemory.update({
        where: { agentSlug: slug(spaceId) },
        data: { beliefs: { startedAt: data.startedAt, durationMinutes: 0 } },
      });
    }
  } catch {}

  return NextResponse.json({ ok: true });
}
