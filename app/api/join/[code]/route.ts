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
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  // Check expiry (null = legacy code with no expiry, still valid)
  if (space.inviteCodeExpiresAt && space.inviteCodeExpiresAt < new Date()) {
    return NextResponse.json({ error: "This invite link has expired. Ask the space owner for a new one." }, { status: 410 });
  }

  // Upsert — idempotent if already a member
  await prisma.spaceMember.upsert({
    where: { userId_spaceId: { userId: session.user.id, spaceId: space.id } },
    create: { userId: session.user.id, spaceId: space.id, role: "MEMBER" },
    update: {},
  });

  // The link is intentionally reusable until it expires — do NOT rotate the code here,
  // otherwise only the first person to join can use a shared invite link.
  return NextResponse.json({ spaceId: space.id, name: space.name });
}
