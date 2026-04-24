import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { capturePayPalOrder } from "@/lib/paypal";
import { z } from "zod";

const Schema = z.object({ orderId: z.string() });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = Schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const { orderId } = body.data;

  // Verify payment record belongs to this user
  const payment = await prisma.payment.findUnique({ where: { externalId: orderId } });
  if (!payment || payment.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (payment.status === "completed") {
    return NextResponse.json({ credits: payment.credits });
  }

  const result = await capturePayPalOrder(orderId);
  if (result.status !== "COMPLETED") {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { externalId: orderId }, data: { status: "completed" } });
    await tx.user.update({ where: { id: payment.userId }, data: { credits: { increment: payment.credits } } });
    await tx.creditTransaction.create({
      data: { userId: payment.userId, amount: payment.credits, reason: "paypal_purchase" },
    });
  });

  return NextResponse.json({ credits: payment.credits });
}
