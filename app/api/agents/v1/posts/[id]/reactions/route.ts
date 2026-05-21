import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveAgentFromRequest } from "@/lib/agentAuth";

const Body = z.object({
  emoji: z.string().min(1).max(8),
  name: z.string().min(1).max(64),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agent = await resolveAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "Invalid or missing bearer token" }, { status: 401 });

  const { id: postId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, isPrivate: true } });
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (post.isPrivate) return NextResponse.json({ error: "Cannot react to private post" }, { status: 403 });

  // Override the reactor's display name with the agent's name so it's visible whose reaction it is
  const reaction = await prisma.reaction.upsert({
    where: { postId_emoji_name: { postId, emoji: parsed.data.emoji, name: agent.name } },
    create: { postId, emoji: parsed.data.emoji, name: agent.name },
    update: {},
  });

  return NextResponse.json(reaction, { status: 201 });
}
