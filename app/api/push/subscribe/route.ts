import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const SubscribeSchema = z.object({
  name: z.string().min(1).max(50),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string(),
    }),
  }),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const result = SubscribeSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { name, subscription } = result.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      name,
    },
    update: { name },
  });

  return NextResponse.json({ ok: true });
}

const UnsubscribeSchema = z.object({ endpoint: z.string().url() });

/** DELETE — this device no longer wants notifications (the Settings switch). */
export async function DELETE(req: NextRequest) {
  const result = UnsubscribeSchema.safeParse(await req.json().catch(() => null));
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: result.data.endpoint } });
  return NextResponse.json({ ok: true });
}
