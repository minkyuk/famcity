import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.user.id, spaceId: id } },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const space = await prisma.space.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, image: true } } },
        orderBy: { joinedAt: "asc" },
      },
      _count: { select: { members: true, posts: true } },
    },
  });

  if (!space) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ...space, role: membership.role });
}
