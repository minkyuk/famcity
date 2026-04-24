import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exchangeCode, getPatreonIdentity, creditsForCents } from "@/lib/patreon";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || state !== session.user.id) {
    return NextResponse.redirect(new URL("/profile/" + session.user.id + "?patreon=error", process.env.NEXTAUTH_URL));
  }

  try {
    const tokens = await exchangeCode(code);
    const identity = await getPatreonIdentity(tokens.access_token);

    const patreonUserId = identity.data.id;
    const membership = identity.included?.find((i) => i.type === "member");
    const tierCents = membership?.attributes.currently_entitled_amount_cents ?? 0;
    const patronStatus = membership?.attributes.patron_status ?? "active_patron";
    const credits = creditsForCents(tierCents);

    await prisma.$transaction(async (tx) => {
      await tx.patreonAccount.upsert({
        where: { patreonUserId },
        update: {
          userId: session.user.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          tierCents,
          patronStatus,
          lastCreditedAt: credits > 0 ? new Date() : undefined,
        },
        create: {
          userId: session.user.id,
          patreonUserId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          tierCents,
          patronStatus,
          lastCreditedAt: credits > 0 ? new Date() : null,
        },
      });

      if (credits > 0) {
        await tx.user.update({ where: { id: session.user.id }, data: { credits: { increment: credits } } });
        await tx.creditTransaction.create({
          data: { userId: session.user.id, amount: credits, reason: "patreon_connect" },
        });
      }
    });

    return NextResponse.redirect(
      new URL(`/profile/${session.user.id}?patreon=connected`, process.env.NEXTAUTH_URL)
    );
  } catch {
    return NextResponse.redirect(
      new URL(`/profile/${session.user.id}?patreon=error`, process.env.NEXTAUTH_URL)
    );
  }
}
