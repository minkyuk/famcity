import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AGENT_MODEL, AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";
import { recordAiCall } from "@/lib/aiCallLog";
import { TranslateSchema, TRANSLATE_MAX_CHARS } from "@/lib/validators";

// Long posts take a while to translate; the platform default can cut the request off mid-way.
export const maxDuration = 60;

/** Failures that never reach Claude (bad input, empty result) are logged too, so the admin
 *  dashboard shows why a translate click did nothing. */
function logRejected(status: number, message: string) {
  return recordAiCall({
    route: "translate:rejected", model: AGENT_MODEL, agent: null, ok: false, status,
    errorType: "invalid_request", errorMessage: message,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const result = TranslateSchema.safeParse(body);
  if (!result.success) {
    const len = typeof (body as { text?: unknown } | null)?.text === "string" ? (body as { text: string }).text.length : null; // body is untrusted JSON; only its text length is read
    const tooLong = len !== null && len > TRANSLATE_MAX_CHARS;
    await logRejected(400, tooLong ? `text too long: ${len} chars (max ${TRANSLATE_MAX_CHARS})` : "invalid body");
    return NextResponse.json({ error: tooLong ? "too_long" : "invalid" }, { status: 400 });
  }

  const { text } = result.data;
  const koreanRatio = (text.match(/[가-힣]/g) ?? []).length / Math.max(text.replace(/\s/g, "").length, 1);
  const targetLang = koreanRatio > 0.3 ? "English" : "Korean (한국어)";
  // Room for the whole translation: Korean↔English can roughly double in tokens.
  const maxTokens = Math.min(8000, Math.max(1300, Math.ceil(text.length * 1.5)));

  try {
    const response = await anthropicFor("translate:translate").messages.create({
      ...AGENT_REQUEST,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: `Translate the following text to ${targetLang}. Return only the translation, nothing else. Keep line breaks.\n\n${text}`,
      }],
    });
    const translated = textOf(response).trim();
    if (!translated) {
      await logRejected(502, `empty translation (stop_reason: ${response.stop_reason ?? "unknown"})`);
      return NextResponse.json({ error: "empty" }, { status: 502 });
    }
    return NextResponse.json({ translated });
  } catch {
    // The API error itself is already in AiCallLog (tracked fetch).
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
