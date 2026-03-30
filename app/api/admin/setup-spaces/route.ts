/**
 * One-time setup: creates the two system spaces if they don't exist yet.
 * Call once after deployment: POST /api/admin/setup-spaces?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/invite";
import { isCronAuthorized } from "@/lib/cronAuth";

async function ensureSpace(name: string, description: string) {
  const existing = await prisma.space.findFirst({ where: { isSystem: true, name } });
  if (existing) return { id: existing.id, created: false };

  let inviteCode = generateInviteCode();
  while (await prisma.space.findUnique({ where: { inviteCode } })) {
    inviteCode = generateInviteCode();
  }

  const space = await prisma.space.create({
    data: { name, description, inviteCode, isSystem: true, excludeFromAll: true },
  });
  return { id: space.id, created: true };
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const news = await ensureSpace(
    "Family News",
    "Daily news and commentary from your AI family reporters"
  );
  const den = await ensureSpace(
    "The Curiosity Den",
    "Science, philosophy, math, history, AI — curious minds in endless conversation"
  );

  return NextResponse.json({ familyNews: news, curiosityDen: den });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
