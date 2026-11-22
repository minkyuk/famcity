import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessiblePost } from "@/lib/postAccess";
import { writeMentions } from "@/lib/agentMentions";
import { z } from "zod";

const BodySchema = z.object({
  body: z.string().min(1).max(1000),
  parentId: z.string().cuid().optional(),
});

const AfterSchema = z.string().datetime();

/**
 * GET ?after=<ISO time> — comments on this post written after that moment, oldest first. The
 * comment thread asks for a short while after a person comments, so replies appear without a reload.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: postId } = await params;
  const post = await getAccessiblePost(postId, session.user.id);
  // A private post is its author's alone.
  if (!post || (post.isPrivate && post.userId !== session.user.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const after = AfterSchema.safeParse(req.nextUrl.searchParams.get("after"));
  if (!after.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const comments = await prisma.comment.findMany({
    where: { postId, createdAt: { gt: new Date(after.data) } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return NextResponse.json({ comments });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: postId } = await params;
  const access = await getAccessiblePost(postId, session.user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const result = BodySchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: {
      postId,
      body: result.data.body,
      authorName: session.user.name ?? "Family Member",
      authorImage: session.user.image ?? null,
      userId: session.user.id,
      ...(result.data.parentId ? { parentId: result.data.parentId } : {}),
    },
  });

  writeMentions({ text: result.data.body, commentId: comment.id }).catch(() => {});

  return NextResponse.json(comment, { status: 201 });
}
