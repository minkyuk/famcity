import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import { z } from "zod";

/** GET /api/credits?userId=... — own balance (or any user for admins) */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = req.nextUrl.searchParams.get("userId") ?? session.user.id;
  if (userId !== session.user.id && !isAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, credits: true } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ credits: user.credits });
}

const GrantSchema = z.object({
  userId: z.string(),
  amount: z.number().int().min(1).max(100_000),
});

/** POST /api/credits — admin grants credits to a user */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const result = GrantSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const { userId, amount } = result.data;
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
      select: { credits: true },
    });
    await tx.creditTransaction.create({
      data: { userId, amount, reason: "admin_grant" },
    });
    return updated;
  });
  return NextResponse.json({ credits: user.credits });
}
