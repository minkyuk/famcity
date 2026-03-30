import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptMessage } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { id: channelId } = await params;
  const since = req.nextUrl.searchParams.get("since");
  let lastSeen = since ? new Date(since) : new Date();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      req.signal.addEventListener("abort", () => { closed = true; });

      // Update presence on connect
      await prisma.onlinePresence.upsert({
        where: { userId: session.user.id },
        create: { userId: session.user.id, name: session.user.name ?? "", image: session.user.image, channelId },
        update: { channelId, lastSeen: new Date(), name: session.user.name ?? "", image: session.user.image },
      });

      const heartbeat = setInterval(async () => {
        if (closed) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          // Refresh presence
          await prisma.onlinePresence.update({
            where: { userId: session.user.id },
            data: { lastSeen: new Date() },
          }).catch(() => {});
        } catch { closed = true; clearInterval(heartbeat); }
      }, 20_000);

      const poll = async () => {
        if (closed) { clearInterval(heartbeat); return; }
        try {
          const newMessages = await prisma.chatMessage.findMany({
            where: { channelId, createdAt: { gt: lastSeen } },
            orderBy: { createdAt: "asc" },
          });

          if (newMessages.length > 0) {
            lastSeen = newMessages[newMessages.length - 1].createdAt;
            const decrypted = newMessages.map((m) => ({ ...m, content: decryptMessage(m.content) }));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "messages", data: decrypted })}\n\n`));
          }

          // Send online count every poll
          const online = await prisma.onlinePresence.findMany({
            where: { channelId, lastSeen: { gt: new Date(Date.now() - 60_000) } },
          });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "presence", data: online })}\n\n`));
        } catch { /* skip */ }

        if (!closed) setTimeout(poll, 2_000);
      };

      setTimeout(poll, 1_000);
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
