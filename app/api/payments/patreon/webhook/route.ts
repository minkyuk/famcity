import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { creditsForCents } from "@/lib/patreon";

type PatreonWebhookPayload = {
  data: {
    id: string;
    type: string;
    attributes: {
      currently_entitled_amount_cents?: number;
      patron_status?: string;
    };
    relationships?: {
      user?: { data?: { id: string } };
    };
  };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-patreon-signature") ?? "";
  const secret = process.env.PATREON_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const expected = createHmac("md5", secret).update(rawBody).digest("hex");
  if (expected !== sig) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const event = req.headers.get("x-patreon-event") ?? "";
  const payload = JSON.parse(rawBody) as PatreonWebhookPayload;

  const patreonUserId = payload.data.relationships?.user?.data?.id ?? payload.data.id;
  const tierCents = payload.data.attributes.currently_entitled_amount_cents ?? 0;
  const patronStatus = payload.data.attributes.patron_status ?? "active_patron";

  const account = await prisma.patreonAccount.findUnique({ where: { patreonUserId } });
  if (!account) return NextResponse.json({ ok: true }); // not linked to any FamCity user

  if (event === "members:pledge:delete" || patronStatus === "declined_patron" || patronStatus === "former_patron") {
    await prisma.patreonAccount.update({
      where: { patreonUserId },
      data: { tierCents: 0, patronStatus },
    });
    return NextResponse.json({ ok: true });
  }

  if (event === "members:pledge:create" || event === "members:pledge:update" || event === "members:update") {
    const credits = creditsForCents(tierCents);

    // Only grant if it's been 28+ days since last credit (monthly cadence)
    const daysSinceLast = account.lastCreditedAt
      ? (Date.now() - account.lastCreditedAt.getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    const isNewPledge = event === "members:pledge:create";
    if (credits > 0 && (isNewPledge || daysSinceLast >= 28)) {
      await prisma.$transaction(async (tx) => {
        await tx.patreonAccount.update({
          where: { patreonUserId },
          data: { tierCents, patronStatus, lastCreditedAt: new Date() },
        });
        await tx.user.update({ where: { id: account.userId }, data: { credits: { increment: credits } } });
        await tx.creditTransaction.create({
          data: { userId: account.userId, amount: credits, reason: "patreon_monthly" },
        });
      });
    } else {
      await prisma.patreonAccount.update({ where: { patreonUserId }, data: { tierCents, patronStatus } });
    }
  }

  return NextResponse.json({ ok: true });
}
