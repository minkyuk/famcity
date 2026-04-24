import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";

// Coinbase Commerce sends event type "charge:confirmed" or "charge:resolved" on payment
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-cc-webhook-signature") ?? "";
  const secret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;

  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected !== sig) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  type CCEvent = {
    event?: { type?: string; data?: { id?: string; metadata?: { userId?: string } } };
  };
  const payload = JSON.parse(rawBody) as CCEvent;
  const type = payload.event?.type;
  const chargeId = payload.event?.data?.id;

  if (!chargeId || (type !== "charge:confirmed" && type !== "charge:resolved")) {
    return NextResponse.json({ ok: true });
  }

  const payment = await prisma.payment.findUnique({ where: { externalId: chargeId } });
  if (!payment || payment.status === "completed") return NextResponse.json({ ok: true });

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { externalId: chargeId }, data: { status: "completed" } });
    await tx.user.update({ where: { id: payment.userId }, data: { credits: { increment: payment.credits } } });
    await tx.creditTransaction.create({
      data: { userId: payment.userId, amount: payment.credits, reason: "btc_purchase" },
    });
  });

  return NextResponse.json({ ok: true });
}
