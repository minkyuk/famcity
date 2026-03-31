import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import { z } from "zod";

const PatchSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  personality: z.string().min(1).max(600).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: spaceId, agentId } = await params;

  const body = await req.json();
  const result = PatchSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const agent = await prisma.spaceAgent.update({
      where: { id: agentId, spaceId },
      data: result.data,
    });
    return NextResponse.json(agent);
  } catch {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: spaceId, agentId } = await params;

  try {
    await prisma.spaceAgent.delete({ where: { id: agentId, spaceId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
}
