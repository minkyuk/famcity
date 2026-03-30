import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ count: 0, posts: [] });

  const since = req.nextUrl.searchParams.get("since");
  const recent = req.nextUrl.searchParams.get("recent") === "1";

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.user.id },
    select: { spaceId: true },
  });
  const spaceIds = memberships.map((m) => m.spaceId);

  const andClauses: object[] = [
    { OR: [{ spaceId: null }, ...(spaceIds.length > 0 ? [{ spaceId: { in: spaceIds } }] : [])] },
    { OR: [{ isPrivate: false }, { userId: session.user.id }] },
  ];

  if (since && !recent) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate.getTime())) {
      andClauses.push({ createdAt: { gt: sinceDate } });
    }
  }

  const posts = await prisma.post.findMany({
    take: 10,
    where: { AND: andClauses },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, image: true } },
      space: { select: { name: true } },
    },
  });

  // For badge count: only count posts since lastSeen
  let count = posts.length;
  if (recent && since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate.getTime())) {
      count = posts.filter((p) => new Date(p.createdAt) > sinceDate).length;
    }
  }

  return NextResponse.json({ count, posts });
}
