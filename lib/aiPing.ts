import Anthropic from "@anthropic-ai/sdk";
import { AGENT_MODEL, AGENT_REQUEST, createAnthropic } from "@/lib/anthropic";
import { classifyAiError, type AiErrorType } from "@/lib/aiCallLog";

const anthropic = createAnthropic("admin-ping");

export type PingResult =
  | { ok: true; model: string; ms: number }
  | { ok: false; model: string; ms: number; status?: number; errorType: AiErrorType; message: string };

/**
 * Live check: one 1-token request with the agents' exact request settings.
 * Tells whether agents can call Claude right now and, if not, why (credits, key, model, limits).
 * Costs a fraction of a cent. Never throws.
 */
export async function pingAgentModel(): Promise<PingResult> {
  const started = Date.now();
  try {
    await anthropic.messages.create(
      { ...AGENT_REQUEST, max_tokens: 1, messages: [{ role: "user", content: "ping" }] },
      { maxRetries: 0 }
    );
    return { ok: true, model: AGENT_MODEL, ms: Date.now() - started };
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status > 0) {
      return { ok: false, model: AGENT_MODEL, ms, status: err.status, errorType: classifyAiError(err.status, null, err.message), message: err.message };
    }
    return { ok: false, model: AGENT_MODEL, ms, errorType: "network", message: err instanceof Error ? err.message : String(err) };
  }
}
