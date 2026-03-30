import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Get all currently online users (last seen within 60s)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const online = await prisma.onlinePresence.findMany({
    where: { lastSeen: { gt: new Date(Date.now() - 60_000) } },
    select: { userId: true, name: true, image: true },
  });

  return NextResponse.json(online);
}

// Heartbeat endpoint — client calls every 30s to stay "online"
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await req.json().catch(() => ({}));

  await prisma.onlinePresence.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, name: session.user.name ?? "", image: session.user.image, channelId: channelId ?? null },
    update: { lastSeen: new Date(), channelId: channelId ?? null },
  });

  return NextResponse.json({ ok: true });
}

// Cleanup stale presence on disconnect
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.onlinePresence.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
