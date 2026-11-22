import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AGENT_NAME_MAX, AGENT_PERSONALITY_MAX, agentNameProblem } from "@/lib/spaceAgentNames";
import { z } from "zod";

const AddAgentSchema = z.object({
  name: z.string().trim().min(1).max(AGENT_NAME_MAX),
  personality: z.string().trim().min(1).max(AGENT_PERSONALITY_MAX),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: spaceId } = await params;

  // Must be a member of the space
  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.user.id, spaceId } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const result = AddAgentSchema.safeParse(body);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return NextResponse.json(
      { error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid input" },
      { status: 400 }
    );
  }

  // Check space agent limit (max 5)
  const existing = await prisma.spaceAgent.findMany({ where: { spaceId }, select: { name: true } });
  if (existing.length >= 5) {
    return NextResponse.json({ error: "Maximum 5 agents per space" }, { status: 400 });
  }

  const { name, personality } = result.data;
  const person = await prisma.user.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  const problem = agentNameProblem(name, existing.map((a) => a.name), person !== null);
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  const slug = `sa-${spaceId.slice(0, 8)}-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;

  const agent = await prisma.spaceAgent.create({
    data: { spaceId, name, personality, slug },
  });

  return NextResponse.json(agent, { status: 201 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: spaceId } = await params;

  const agents = await prisma.spaceAgent.findMany({
    where: { spaceId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(agents);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: spaceId } = await params;

  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.user.id, spaceId } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { agentId } = await req.json();
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });

  await prisma.spaceAgent.delete({ where: { id: agentId, spaceId } });
  return NextResponse.json({ ok: true });
}
