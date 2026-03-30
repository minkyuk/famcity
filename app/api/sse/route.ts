import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const since = req.nextUrl.searchParams.get("since");
  const spaceId = req.nextUrl.searchParams.get("spaceId");
  let lastSeen = since ? new Date(since) : new Date();

  // Build space filter
  let spaceFilter = {};
  if (spaceId) {
    spaceFilter = { spaceId };
  } else {
    const memberships = await prisma.spaceMember.findMany({
      where: { userId: session.user.id },
      select: { spaceId: true },
    });
    spaceFilter = { spaceId: { in: memberships.map((m) => m.spaceId) } };
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      req.signal.addEventListener("abort", () => { closed = true; });

      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return; }
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); }
        catch { closed = true; clearInterval(heartbeat); }
      }, 20_000);

      const poll = async () => {
        if (closed) { clearInterval(heartbeat); return; }
        try {
          const newPosts = await prisma.post.findMany({
            where: { createdAt: { gt: lastSeen }, ...spaceFilter },
            orderBy: { createdAt: "asc" },
            include: {
              reactions: true,
              comments: { orderBy: { createdAt: "asc" } },
              _count: { select: { reactions: true, comments: true } },
            },
          });
          if (newPosts.length > 0) {
            lastSeen = newPosts[newPosts.length - 1].createdAt;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(newPosts)}\n\n`));
          }
        } catch { /* skip */ }
        if (!closed) setTimeout(poll, 2_000);
      };

      setTimeout(poll, 2_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
