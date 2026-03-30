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

  // Get spaces the user is a member of
  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.user.id },
    select: { spaceId: true, space: { select: { name: true } } },
  });
  const spaceIds = memberships.map((m) => m.spaceId);

  // Auto-create a chat channel for each space if one doesn't exist yet
  for (const { spaceId, space } of memberships) {
    const exists = await prisma.chatChannel.findFirst({ where: { spaceId } });
    if (!exists && space?.name) {
      await prisma.chatChannel.create({
        data: { name: space.name, isGlobal: false, spaceId },
      });
    }
  }

  // Show global channels + channels belonging to the user's spaces
  const channels = await prisma.chatChannel.findMany({
    where: {
      OR: [
        { isGlobal: true },
        { spaceId: { in: spaceIds } },
      ],
    },
    orderBy: [{ isGlobal: "desc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { messages: true, presence: true } },
      space: { select: { name: true } },
    },
  });

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
  spaceId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const result = CreateChannelSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { name, description, password, spaceId } = result.data;

  // Verify membership if scoping to a space
  if (spaceId) {
    const member = await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: session.user.id, spaceId } },
    });
    if (!member) return NextResponse.json({ error: "Not a member of that space" }, { status: 403 });
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  const channel = await prisma.chatChannel.create({
    data: { name, description, passwordHash, createdById: session.user.id, spaceId: spaceId ?? null },
    include: { _count: { select: { messages: true, presence: true } }, space: { select: { name: true } } },
  });

  return NextResponse.json({ ...channel, passwordHash: undefined, hasPassword: !!passwordHash }, { status: 201 });
}
