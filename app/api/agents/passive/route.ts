import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import { PASSIVE_MODE_HOURS, passiveModeRemainingMs } from "@/lib/agentModes";

const SLUG = "$passive-mode";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const record = await prisma.agentMemory.findUnique({ where: { agentSlug: SLUG } });
    const remainingMs = passiveModeRemainingMs(record?.beliefs);
    return NextResponse.json({ active: remainingMs > 0, remainingMinutes: Math.ceil(remainingMs / 60_000) });
  } catch { return NextResponse.json({ active: false }); }
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.agentMemory.upsert({
    where: { agentSlug: SLUG },
    create: { agentSlug: SLUG, beliefs: { active: true, startedAt: new Date().toISOString() } },
    update: { beliefs: { active: true, startedAt: new Date().toISOString() } },
  });
  return NextResponse.json({ ok: true, active: true, remainingMinutes: PASSIVE_MODE_HOURS * 60 });
}

export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try { await prisma.agentMemory.delete({ where: { agentSlug: SLUG } }); } catch {}
  return NextResponse.json({ ok: true, active: false });
}
