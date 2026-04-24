import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/comments/liked?postId=xxx
 *  Returns the comment IDs on a post that the current user has liked. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ likedIds: [] });

  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ likedIds: [] });

  const likes = await prisma.commentLike.findMany({
    where: { userId: session.user.id, comment: { postId } },
    select: { commentId: true },
  });

  return NextResponse.json({ likedIds: likes.map((l) => l.commentId) });
}
