import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Ensure a global channel exists
  const globalExists = await prisma.chatChannel.findFirst({ where: { isGlobal: true } });
  if (!globalExists) {
    await prisma.chatChannel.create({
      data: { name: "General", description: "Everyone is welcome here", isGlobal: true },
    });
  }

  const channels = await prisma.chatChannel.findMany({
    orderBy: [{ isGlobal: "desc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { messages: true, presence: true } },
    },
  });

  // Strip password hashes from response
  return NextResponse.json(
    channels.map(({ passwordHash, ...c }) => ({
      ...c,
      hasPassword: !!passwordHash,
    }))
  );
}

const CreateChannelSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  password: z.string().min(4).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const result = CreateChannelSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { name, description, password } = result.data;
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  const channel = await prisma.chatChannel.create({
    data: { name, description, passwordHash, createdById: session.user.id },
    include: { _count: { select: { messages: true, presence: true } } },
  });

  return NextResponse.json({ ...channel, passwordHash: undefined, hasPassword: !!passwordHash }, { status: 201 });
}
