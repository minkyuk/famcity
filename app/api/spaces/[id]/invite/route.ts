import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/invite";

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** GET /api/spaces/[id]/invite
 *  Returns the current invite code + expiry for owners/admins.
 *  Auto-rotates if the code has expired.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Must be a member (owner) of the space
  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.user.id, spaceId: id } },
  });
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let space = await prisma.space.findUnique({
    where: { id },
    select: { id: true, inviteCode: true, inviteCodeExpiresAt: true },
  });
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Rotate if expired or never set
  const expired = !space.inviteCodeExpiresAt || space.inviteCodeExpiresAt < new Date();
  if (expired) {
    let newCode = generateInviteCode();
    while (await prisma.space.findUnique({ where: { inviteCode: newCode } })) {
      newCode = generateInviteCode();
    }
    space = await prisma.space.update({
      where: { id },
      data: { inviteCode: newCode, inviteCodeExpiresAt: new Date(Date.now() + EXPIRY_MS) },
      select: { id: true, inviteCode: true, inviteCodeExpiresAt: true },
    });
  }

  return NextResponse.json({
    code: space.inviteCode,
    expiresAt: space.inviteCodeExpiresAt,
  });
}
