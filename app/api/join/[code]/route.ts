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

  // Rotate the invite code so it can't be reused
  const { generateInviteCode } = await import("@/lib/invite");
  let newCode = generateInviteCode();
  while (await prisma.space.findUnique({ where: { inviteCode: newCode } })) {
    newCode = generateInviteCode();
  }
  await prisma.space.update({
    where: { id: space.id },
    data: {
      inviteCode: newCode,
      inviteCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return NextResponse.json({ spaceId: space.id, name: space.name });
}
