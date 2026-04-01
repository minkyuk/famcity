import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

const SLUG = "$passive-mode";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const record = await prisma.agentMemory.findUnique({ where: { agentSlug: SLUG } });
    const d = record?.beliefs as { active?: boolean } | null;
    return NextResponse.json({ active: !!d?.active });
  } catch { return NextResponse.json({ active: false }); }
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.agentMemory.upsert({
    where: { agentSlug: SLUG },
    create: { agentSlug: SLUG, beliefs: { active: true } },
    update: { beliefs: { active: true } },
  });
  return NextResponse.json({ ok: true, active: true });
}

export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try { await prisma.agentMemory.delete({ where: { agentSlug: SLUG } }); } catch {}
  return NextResponse.json({ ok: true, active: false });
}
