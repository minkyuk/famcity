import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const MSG_INCLUDE = {
  fromUser: { select: { id: true, name: true, image: true } },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: otherId } = await params;
  const meId = session.user.id;

  const messages = await prisma.directMessage.findMany({
    where: {
      OR: [
        { fromUserId: meId, toUserId: otherId },
        { fromUserId: otherId, toUserId: meId },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: MSG_INCLUDE,
  });

  // Mark unread messages as read
  await prisma.directMessage.updateMany({
    where: { fromUserId: otherId, toUserId: meId, read: false },
    data: { read: true },
  });

  return NextResponse.json(messages);
}

const SendSchema = z.object({
  content: z.string().min(1).max(2000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: toId } = await params;
  const body = await req.json();
  const result = SendSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  // Make sure recipient exists
  const recipient = await prisma.user.findUnique({ where: { id: toId }, select: { id: true } });
  if (!recipient) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const message = await prisma.directMessage.create({
    data: {
      fromUserId: session.user.id,
      toUserId: toId,
      content: result.data.content,
    },
    include: MSG_INCLUDE,
  });

  return NextResponse.json(message, { status: 201 });
}
