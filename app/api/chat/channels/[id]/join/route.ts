import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { password } = await req.json().catch(() => ({}));

  const channel = await prisma.chatChannel.findUnique({ where: { id } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  if (channel.passwordHash) {
    if (!password) return NextResponse.json({ error: "Password required" }, { status: 403 });
    const valid = await bcrypt.compare(password, channel.passwordHash);
    if (!valid) return NextResponse.json({ error: "Wrong password" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, channelId: id });
}
