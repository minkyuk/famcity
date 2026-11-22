import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import { agentAvatarUrl } from "@/lib/agents";
import { AGENT_NAME_MAX, AGENT_PERSONALITY_MAX, agentNameProblem } from "@/lib/spaceAgentNames";
import { z } from "zod";

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(AGENT_NAME_MAX).optional(),
    personality: z.string().trim().min(1).max(AGENT_PERSONALITY_MAX).optional(),
  })
  .refine((d) => d.name !== undefined || d.personality !== undefined, { message: "Nothing to change" });

/**
 * Renames a space agent or rewrites its personality. Members of the space may do this — the same
 * people who may add an agent there — and site admins. The new personality is used from the
 * agent's next turn. A rename also renames the agent's earlier posts and comments in its space,
 * so the thread reads as one agent and the agent still recognises what it wrote.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; agentId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: spaceId, agentId } = await params;

  const agent = await prisma.spaceAgent.findFirst({ where: { id: agentId, spaceId }, select: { id: true, name: true, slug: true } });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!isAdmin(session)) {
    const membership = await prisma.spaceMember.findUnique({ where: { userId_spaceId: { userId: session.user.id, spaceId } } });
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!result.success) {
    const issue = result.error.issues[0];
    return NextResponse.json({ error: issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input" }, { status: 400 });
  }
  const { name, personality } = result.data;
  const renamed = name !== undefined && name !== agent.name;
  if (renamed) {
    const [others, person] = await Promise.all([
      prisma.spaceAgent.findMany({ where: { spaceId, NOT: { id: agentId } }, select: { name: true } }),
      prisma.user.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } }),
    ]);
    const problem = agentNameProblem(name, others.map((o) => o.name), person !== null);
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // The name as it is now, inside the transaction: two renames at once must not leave the
      // agent's older comments under a name it no longer has.
      const current = await tx.spaceAgent.findUnique({ where: { id: agentId }, select: { name: true } });
      if (!current) throw new Error("agent deleted meanwhile");
      const saved = await tx.spaceAgent.update({
        where: { id: agentId },
        data: { ...(renamed ? { name } : {}), ...(personality !== undefined ? { personality } : {}) },
      });
      if (renamed && current.name !== name) {
        // Its own posts and comments: no account, its old name, its own avatar (from the slug), its space.
        const own = { authorName: current.name, userId: null, authorImage: agentAvatarUrl(agent.slug) };
        await tx.comment.updateMany({ where: { ...own, post: { spaceId } }, data: { authorName: name } });
        await tx.post.updateMany({ where: { ...own, spaceId }, data: { authorName: name } });
      }
      return saved;
    });
    return NextResponse.json(updated);
  } catch (err) {
    // The unique (space, name) index: someone took the name a moment ago.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: `This space already has an agent called "${name ?? agent.name}"` }, { status: 409 });
    }
    console.error("[space agent] update failed", err);
    return NextResponse.json({ error: "Could not save the agent" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; agentId: string }> }) {
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
