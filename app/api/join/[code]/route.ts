import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { code } = await params;

  const space = await prisma.space.findUnique({ where: { inviteCode: code } });
  if (!space) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  }

  // Upsert — idempotent if already a member
  await prisma.spaceMember.upsert({
    where: { userId_spaceId: { userId: session.user.id, spaceId: space.id } },
    create: { userId: session.user.id, spaceId: space.id, role: "MEMBER" },
    update: {},
  });

  return NextResponse.json({ spaceId: space.id, name: space.name });
}
