import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  if (!since) return NextResponse.json({ count: 0 });

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return NextResponse.json({ count: 0 });
  }

  const count = await prisma.post.count({
    where: { createdAt: { gt: sinceDate } },
  });

  return NextResponse.json({ count });
}
