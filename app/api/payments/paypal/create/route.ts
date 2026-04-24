import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPackage } from "@/lib/creditPackages";
import { createPayPalOrder } from "@/lib/paypal";
import { z } from "zod";

const Schema = z.object({ packageId: z.string() });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = Schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const pkg = getPackage(body.data.packageId);
  if (!pkg) return NextResponse.json({ error: "Unknown package" }, { status: 400 });

  const orderId = await createPayPalOrder(pkg.usdCents, `${pkg.credits} FamCity Credits`);

  await prisma.payment.create({
    data: {
      userId: session.user.id,
      credits: pkg.credits,
      usdCents: pkg.usdCents,
      provider: "paypal",
      externalId: orderId,
      status: "pending",
    },
  });

  return NextResponse.json({ orderId });
}
