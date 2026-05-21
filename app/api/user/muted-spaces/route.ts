import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/** GET — returns list of spaceIds the current user has muted */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mutes = await prisma.userSpaceMute.findMany({
    where: { userId: session.user.id },
    select: { spaceId: true },
  });
  return NextResponse.json({ mutedSpaceIds: mutes.map((m) => m.spaceId) });
}

const BodySchema = z.object({ spaceId: z.string().cuid() });

/** POST — mute a space (idempotent) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const result = BodySchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  await prisma.userSpaceMute.upsert({
    where: { userId_spaceId: { userId: session.user.id, spaceId: result.data.spaceId } },
    create: { userId: session.user.id, spaceId: result.data.spaceId },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

/** DELETE — unmute a space */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const result = BodySchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  await prisma.userSpaceMute.deleteMany({
    where: { userId: session.user.id, spaceId: result.data.spaceId },
  });
  return NextResponse.json({ ok: true });
}
