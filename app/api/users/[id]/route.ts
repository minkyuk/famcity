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

  const posts = await prisma.post.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      reactions: true,
      comments: { orderBy: { createdAt: "asc" } },
      media: { orderBy: { order: "asc" } },
      hashtags: { include: { hashtag: true } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  return NextResponse.json({ user, posts });
}

const PatchSchema = z.object({ bio: z.string().max(500) });

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
    data: { bio: result.data.bio },
    select: { id: true, name: true, image: true, bio: true },
  });

  return NextResponse.json(user);
}
