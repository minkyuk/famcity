import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/dm — list all conversations, latest message per partner, unread count */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const myId = session.user.id;

  const allDMs = await prisma.directMessage.findMany({
    where: { OR: [{ fromUserId: myId }, { toUserId: myId }] },
    orderBy: { createdAt: "desc" },
    include: {
      fromUser: { select: { id: true, name: true, image: true } },
      toUser: { select: { id: true, name: true, image: true } },
    },
  });

  // Group by partner, keep only the latest message per conversation
  const byPartner = new Map<string, {
    partner: { id: string; name: string | null; image: string | null };
    lastMessage: string;
    lastAt: Date;
    unread: number;
  }>();

  for (const dm of allDMs) {
    const partner = dm.fromUserId === myId ? dm.toUser : dm.fromUser;
    if (!byPartner.has(partner.id)) {
      byPartner.set(partner.id, { partner, lastMessage: dm.content, lastAt: dm.createdAt, unread: 0 });
    }
    if (!dm.read && dm.toUserId === myId) {
      byPartner.get(partner.id)!.unread++;
    }
  }

  return NextResponse.json([...byPartner.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()));
}

/** GET /api/dm/unread-count — total unread across all conversations */
export async function HEAD() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse(null, { status: 401 });
  const count = await prisma.directMessage.count({ where: { toUserId: session.user.id, read: false } });
  return new NextResponse(null, { headers: { "x-unread-count": String(count) } });
}
