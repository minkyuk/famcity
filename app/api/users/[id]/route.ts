import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, image: true, bio: true, email: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find spaces the viewer belongs to
  const viewerMemberships = await prisma.spaceMember.findMany({
    where: { userId: session.user.id },
    select: { spaceId: true },
  });
  const viewerSpaceIds = viewerMemberships.map((m) => m.spaceId);

  // Only show posts that are global (spaceId = null) or in a space the viewer is also in
  const posts = await prisma.post.findMany({
    where: {
      userId: id,
      OR: [{ spaceId: null }, { spaceId: { in: viewerSpaceIds } }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      reactions: true,
      comments: { orderBy: { createdAt: "asc" } },
      media: { orderBy: { order: "asc" } },
      hashtags: { include: { hashtag: true } },
      space: { select: { name: true } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  return NextResponse.json({ user, posts });
}

const PatchSchema = z.object({
  bio: z.string().max(500).optional(),
  name: z.string().min(1).max(50).optional(),
  image: z.string().url().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (session.user.id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const result = PatchSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(result.data.bio !== undefined && { bio: result.data.bio }),
      ...(result.data.name !== undefined && { name: result.data.name }),
      ...(result.data.image !== undefined && { image: result.data.image }),
    },
    select: { id: true, name: true, image: true, bio: true },
  });

  return NextResponse.json(user);
}
