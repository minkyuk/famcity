import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ count: 0, items: [], posts: [] });

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
    { userId: { not: session.user.id } }, // exclude own posts from notifications
  ];

  // Fetch recent posts from others
  const posts = await prisma.post.findMany({
    take: 10,
    where: { AND: andClauses },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, image: true } },
      space: { select: { name: true } },
    },
  });

  // Fetch recent comments on posts the user authored
  const comments = await prisma.comment.findMany({
    take: 10,
    where: {
      post: { userId: session.user.id },
      userId: { not: session.user.id }, // exclude own comments
    },
    orderBy: { createdAt: "desc" },
    include: {
      post: { select: { id: true, content: true, space: { select: { name: true } } } },
    },
  });

  // Merge into unified notification items sorted by time
  type NotifItem =
    | { kind: "post"; id: string; postId: string; authorName: string; authorImage: string | null; content: string | null; spaceName: string | null; createdAt: string }
    | { kind: "comment"; id: string; postId: string; authorName: string; authorImage: string | null; body: string; postContent: string | null; spaceName: string | null; createdAt: string };

  const items: NotifItem[] = [
    ...posts.map((p) => ({
      kind: "post" as const,
      id: p.id,
      postId: p.id,
      authorName: p.user?.name ?? p.authorName,
      authorImage: p.user?.image ?? p.authorImage ?? null,
      content: p.content,
      spaceName: p.space?.name ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    ...comments.map((c) => ({
      kind: "comment" as const,
      id: c.id,
      postId: c.postId,
      authorName: c.authorName,
      authorImage: c.authorImage ?? null,
      body: c.body,
      postContent: c.post.content,
      spaceName: c.post.space?.name ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
   .slice(0, 15);

  // Badge count: items since lastSeen
  let count = items.length;
  if (recent && since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate.getTime())) {
      count = items.filter((i) => new Date(i.createdAt) > sinceDate).length;
    }
  }

  // Keep backward-compat `posts` field for badge-count-only call
  return NextResponse.json({ count, items, posts });
}
