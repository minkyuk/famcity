import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptMessage, decryptMessage } from "@/lib/crypto";
import { z } from "zod";

const PAGE = 50;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const cursor = req.nextUrl.searchParams.get("cursor");

  const messages = await prisma.chatMessage.findMany({
    where: { channelId },
    take: PAGE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
  });

  const decrypted = messages.map((m) => ({
    ...m,
    content: decryptMessage(m.content),
  }));

  const nextCursor = messages.length === PAGE ? messages[messages.length - 1].id : null;
  return NextResponse.json({ messages: decrypted.reverse(), nextCursor });
}

const SendSchema = z.object({ content: z.string().min(1).max(2000) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const body = await req.json();
  const result = SendSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const encrypted = encryptMessage(result.data.content);

  const message = await prisma.chatMessage.create({
    data: {
      channelId,
      userId: session.user.id,
      userName: session.user.name ?? "Member",
      userImage: session.user.image ?? null,
      content: encrypted,
    },
  });

  return NextResponse.json({
    ...message,
    content: result.data.content, // return plaintext to sender
  }, { status: 201 });
}
