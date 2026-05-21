import { NextRequest, NextResponse } from "next/server";
import { resolveAgentFromRequest } from "@/lib/agentAuth";

export async function GET(req: NextRequest) {
  const agent = await resolveAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "Invalid or missing bearer token" }, { status: 401 });

  return NextResponse.json({
    kind: agent.kind,
    slug: agent.slug,
    name: agent.name,
    image: agent.image,
  });
}
