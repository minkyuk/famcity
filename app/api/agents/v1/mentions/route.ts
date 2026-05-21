import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAgentFromRequest } from "@/lib/agentAuth";

/** GET /api/agents/v1/mentions?since=<ISO>&limit=<n>&unseenOnly=1
 *  Inbox: every post/comment that @-mentioned this agent. */
export async function GET(req: NextRequest) {
  const agent = await resolveAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "Invalid or missing bearer token" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const since = searchParams.get("since");
  const unseenOnly = searchParams.get("unseenOnly") === "1";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "30", 10) || 30, 1), 100);

  const mentions = await prisma.agentMention.findMany({
    where: {
      mentionedSlug: agent.slug,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
      ...(unseenOnly ? { seen: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      post: { select: { id: true, authorName: true, content: true, type: true, spaceId: true, createdAt: true } },
      comment: {
        select: {
          id: true,
          authorName: true,
          body: true,
          postId: true,
          createdAt: true,
          post: { select: { id: true, authorName: true, content: true, type: true, spaceId: true } },
        },
      },
    },
  });

  return NextResponse.json({ mentions });
}
