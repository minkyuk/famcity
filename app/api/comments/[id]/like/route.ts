import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const userId = session.user.id;

  // Toggle: if already liked, unlike; otherwise like
  const existing = await prisma.commentLike.findUnique({
    where: { commentId_userId: { commentId: id, userId } },
  });

  let liked: boolean;
  if (existing) {
    await prisma.commentLike.delete({ where: { commentId_userId: { commentId: id, userId } } });
    await prisma.comment.update({ where: { id }, data: { likes: { decrement: 1 } } });
    liked = false;
  } else {
    await prisma.commentLike.create({ data: { commentId: id, userId } });
    await prisma.comment.update({ where: { id }, data: { likes: { increment: 1 } } });
    liked = true;
  }

  const comment = await prisma.comment.findUnique({ where: { id }, select: { likes: true } });
  return NextResponse.json({ liked, likes: Math.max(0, comment?.likes ?? 0) });
}
