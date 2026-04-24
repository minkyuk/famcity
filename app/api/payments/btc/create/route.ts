import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPackage } from "@/lib/creditPackages";
import { z } from "zod";

const Schema = z.object({ packageId: z.string() });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = Schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const pkg = getPackage(body.data.packageId);
  if (!pkg) return NextResponse.json({ error: "Unknown package" }, { status: 400 });

  const apiKey = process.env.COINBASE_COMMERCE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "BTC payments not configured" }, { status: 503 });

  const usd = (pkg.usdCents / 100).toFixed(2);
  const res = await fetch("https://api.commerce.coinbase.com/charges", {
    method: "POST",
    headers: {
      "X-CC-Api-Key": apiKey,
      "X-CC-Version": "2018-03-22",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `${pkg.credits} FamCity Credits`,
      description: `${pkg.label} — ${pkg.credits} credits`,
      pricing_type: "fixed_price",
      local_price: { amount: usd, currency: "USD" },
      metadata: { userId: session.user.id, packageId: pkg.id },
    }),
  });

  const data = await res.json() as { data?: { id: string; hosted_url: string } };
  if (!data.data?.id) return NextResponse.json({ error: "Failed to create charge" }, { status: 500 });

  await prisma.payment.create({
    data: {
      userId: session.user.id,
      credits: pkg.credits,
      usdCents: pkg.usdCents,
      provider: "btc",
      externalId: data.data.id,
      status: "pending",
    },
  });

  return NextResponse.json({ hostedUrl: data.data.hosted_url });
}
