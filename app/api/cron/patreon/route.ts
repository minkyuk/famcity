import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatreonIdentity, creditsForCents } from "@/lib/patreon";
import { isCronAuthorized } from "@/lib/cronAuth";

/** Monthly cron: re-verify active Patreon patrons and grant credits */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await prisma.patreonAccount.findMany({
    where: { patronStatus: "active_patron", tierCents: { gt: 0 } },
  });

  let granted = 0;
  for (const account of accounts) {
    const daysSinceLast = account.lastCreditedAt
      ? (Date.now() - account.lastCreditedAt.getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    if (daysSinceLast < 28) continue;

    try {
      // Re-verify still an active patron via Patreon API
      const identity = await getPatreonIdentity(account.accessToken);
      const membership = identity.included?.find((i) => i.type === "member");
      const tierCents = membership?.attributes.currently_entitled_amount_cents ?? 0;
      const patronStatus = membership?.attributes.patron_status ?? "former_patron";

      if (patronStatus !== "active_patron" || tierCents === 0) {
        await prisma.patreonAccount.update({
          where: { id: account.id },
          data: { tierCents, patronStatus },
        });
        continue;
      }

      const credits = creditsForCents(tierCents);
      await prisma.$transaction(async (tx) => {
        await tx.patreonAccount.update({
          where: { id: account.id },
          data: { tierCents, patronStatus, lastCreditedAt: new Date() },
        });
        await tx.user.update({ where: { id: account.userId }, data: { credits: { increment: credits } } });
        await tx.creditTransaction.create({
          data: { userId: account.userId, amount: credits, reason: "patreon_monthly" },
        });
      });
      granted++;
    } catch {
      // skip this account, try again next run
    }
  }

  return NextResponse.json({ ok: true, granted });
}
