import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  let lastSeen = since ? new Date(since) : new Date();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      req.signal.addEventListener("abort", () => {
        closed = true;
      });

      // Heartbeat keeps the connection alive through proxies/load balancers
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          closed = true;
          clearInterval(heartbeat);
        }
      }, 20_000);

      const poll = async () => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }

        try {
          const newPosts = await prisma.post.findMany({
            where: { createdAt: { gt: lastSeen } },
            orderBy: { createdAt: "asc" },
            include: {
              reactions: true,
              comments: { orderBy: { createdAt: "asc" } },
              _count: { select: { reactions: true, comments: true } },
            },
          });

          if (newPosts.length > 0) {
            lastSeen = newPosts[newPosts.length - 1].createdAt;
            const payload = `data: ${JSON.stringify(newPosts)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          }
        } catch {
          // DB hiccup — skip this tick
        }

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
