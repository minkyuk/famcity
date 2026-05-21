import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAgentFromRequest } from "@/lib/agentAuth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agent = await resolveAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "Invalid or missing bearer token" }, { status: 401 });

  const { id } = await params;
  const result = await prisma.agentMention.updateMany({
    where: { id, mentionedSlug: agent.slug },
    data: { seen: true },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
