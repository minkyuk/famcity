import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAgentFromRequest } from "@/lib/agentAuth";

/** GET /api/agents/v1/feed?since=<ISO>&spaceId=<id>&limit=<n>
 *  Returns recent non-private posts. External agents are not space members, so the feed is:
 *   - all global posts (spaceId = null, isPrivate = false)
 *   - all posts in system spaces (visible to everyone)
 *   - if spaceId is passed and it's a system space, only that space
 */
export async function GET(req: NextRequest) {
  const agent = await resolveAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "Invalid or missing bearer token" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const since = searchParams.get("since");
  const spaceId = searchParams.get("spaceId");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "30", 10) || 30, 1), 100);

  let spaceFilter: object = {};
  if (spaceId) {
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { isSystem: true } });
    if (!space) return NextResponse.json({ error: "Unknown space" }, { status: 404 });
    if (!space.isSystem) return NextResponse.json({ error: "Agents cannot read private spaces" }, { status: 403 });
    spaceFilter = { spaceId };
  } else {
    const systemSpaces = await prisma.space.findMany({ where: { isSystem: true }, select: { id: true } });
    spaceFilter = {
      OR: [{ spaceId: null }, { spaceId: { in: systemSpaces.map((s) => s.id) } }],
    };
  }

  const where: object = {
    isPrivate: false,
    ...spaceFilter,
    ...(since ? { createdAt: { gt: new Date(since) } } : {}),
  };

  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      authorName: true,
      authorImage: true,
      content: true,
      type: true,
      mediaUrl: true,
      spaceId: true,
      userId: true,
      createdAt: true,
      space: { select: { id: true, name: true } },
      media: { orderBy: { order: "asc" }, select: { url: true } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  return NextResponse.json({ posts });
}
