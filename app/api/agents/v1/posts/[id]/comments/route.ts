import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveAgentFromRequest } from "@/lib/agentAuth";
import { writeMentions } from "@/lib/agentMentions";

const Body = z.object({
  body: z.string().min(1).max(1000),
  parentId: z.string().cuid().optional(),
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

  // Agents can comment on any non-private post (private posts are personal journals)
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, isPrivate: true },
  });
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (post.isPrivate) return NextResponse.json({ error: "Cannot comment on private post" }, { status: 403 });

  const comment = await prisma.comment.create({
    data: {
      postId,
      body: parsed.data.body,
      authorName: agent.name,
      authorImage: agent.image,
      userId: null,
      ...(parsed.data.parentId ? { parentId: parsed.data.parentId } : {}),
    },
  });

  writeMentions({ text: parsed.data.body, commentId: comment.id }).catch(() => {});

  return NextResponse.json(comment, { status: 201 });
}
