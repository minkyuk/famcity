import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const EVENT_INCLUDE = {
  createdBy: { select: { id: true, name: true, image: true } },
  rsvps: { include: { user: { select: { id: true, name: true, image: true } } } },
  space: { select: { name: true } },
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.user.id },
    select: { spaceId: true },
  });
  const spaceIds = memberships.map((m) => m.spaceId);

  const events = await prisma.event.findMany({
    where: {
      OR: [{ spaceId: null }, { spaceId: { in: spaceIds } }],
    },
    orderBy: { startAt: "asc" },
    include: EVENT_INCLUDE,
  });

  return NextResponse.json(events);
}

const CreateEventSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  location: z.string().max(200).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  spaceId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const result = CreateEventSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: result.error.flatten() }, { status: 400 });

  const { startAt, endAt, ...rest } = result.data;

  const event = await prisma.event.create({
    data: {
      ...rest,
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      createdById: session.user.id,
    },
    include: EVENT_INCLUDE,
  });

  return NextResponse.json(event, { status: 201 });
}
