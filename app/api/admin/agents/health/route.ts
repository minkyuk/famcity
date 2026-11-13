import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { pingAgentModel } from "@/lib/aiPing";

/**
 * POST — admin-only live check behind the dashboard's "지금 API 테스트" button.
 * Takes no input, so there is no body to validate.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await pingAgentModel());
}
