import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AGENTS } from "@/lib/agents";
import { isAdmin } from "@/lib/admin";
import { z } from "zod";

const PatchSchema = z.object({
  description: z.string().max(1000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  if (!AGENTS.find((a) => a.slug === slug)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const result = PatchSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const description = result.data.description?.trim() ?? null;

  await prisma.agentMemory.upsert({
    where: { agentSlug: slug },
    update: { description },
    create: { agentSlug: slug, beliefs: [], description },
  });

  return NextResponse.json({ ok: true });
}
