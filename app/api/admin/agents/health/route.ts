import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { AGENT_MODEL, createAnthropic } from "@/lib/anthropic";
import { classifyAiError } from "@/lib/aiCallLog";

const anthropic = createAnthropic("admin-ping");

/**
 * POST — admin-only live check: sends a 1-token request with the agents' model and reports
 * whether it worked and, if not, why (credits, key, model, rate limit...). Costs a fraction of a cent.
 * Takes no input, so there is no body to validate.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const started = Date.now();
  try {
    await anthropic.messages.create(
      { model: AGENT_MODEL, max_tokens: 1, messages: [{ role: "user", content: "ping" }] },
      { maxRetries: 0 }
    );
    return NextResponse.json({ ok: true, model: AGENT_MODEL, ms: Date.now() - started });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const status = typeof err.status === "number" ? err.status : 0;
      return NextResponse.json({
        ok: false,
        model: AGENT_MODEL,
        ms: Date.now() - started,
        status,
        errorType: status ? classifyAiError(status, null, err.message) : "network",
        message: err.message,
      });
    }
    return NextResponse.json({
      ok: false, model: AGENT_MODEL, ms: Date.now() - started, errorType: "network",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
