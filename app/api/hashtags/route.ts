import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spaceId = req.nextUrl.searchParams.get("spaceId");

  // Get space IDs user belongs to
  let spaceIds: string[] = [];
  if (spaceId) {
    spaceIds = [spaceId];
  } else {
    const memberships = await prisma.spaceMember.findMany({
      where: { userId: session.user.id },
      select: { spaceId: true },
    });
    spaceIds = memberships.map((m) => m.spaceId);
  }

  // Get hashtags that appear in posts within those spaces, sorted by frequency
  const hashtags = await prisma.hashtag.findMany({
    where: {
      posts: {
        some: {
          post: { spaceId: { in: spaceIds } },
        },
      },
    },
    include: {
      _count: { select: { posts: true } },
    },
    orderBy: { posts: { _count: "desc" } },
    take: 50,
  });

  return NextResponse.json(hashtags);
}
