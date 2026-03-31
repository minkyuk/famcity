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

  // Reject if within cooldown (admins bypass)
  if (!admin) {
    try {
      const record = await prisma.agentMemory.findUnique({ where: { agentSlug: slug(spaceId) } });
      if (record) {
        const data = record.beliefs as { startedAt?: string };
        if (data?.startedAt) {
          const elapsed = Date.now() - new Date(data.startedAt).getTime();
          if (elapsed < COOLDOWN_MINUTES * 60 * 1000) {
            const s = Math.ceil((COOLDOWN_MINUTES * 60 * 1000 - elapsed) / 1000);
            const m = Math.ceil(s / 60);
            return NextResponse.json({ error: `Cooldown active — ${m}m remaining` }, { status: 429 });
          }
        }
      }
    } catch {}
  }

  await prisma.agentMemory.upsert({
    where: { agentSlug: slug(spaceId) },
    update: { beliefs: { startedAt: new Date().toISOString(), durationMinutes: DURATION_MINUTES } },
    create: { agentSlug: slug(spaceId), beliefs: { startedAt: new Date().toISOString(), durationMinutes: DURATION_MINUTES } },
  });

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
