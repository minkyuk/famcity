import Anthropic from "@anthropic-ai/sdk";
import { classifyAiError, recordAiCall } from "@/lib/aiCallLog";
import { currentAgent } from "@/lib/agentContext";

/** The model every agent route uses (discuss, news, translate, admin ping). */
export const AGENT_MODEL = "claude-haiku-5-5";

/**
 * Shared request fields for agent calls. Claude Haiku 5.5 thinks by default; agents never needed it
 * (they ran on Haiku 4.5 without thinking), and thinking tokens would both cost money and eat into
 * tiny caps like the 10-token YES/NO gates. `disabled` is accepted at the default effort (medium).
 */
export const AGENT_REQUEST = {
  model: AGENT_MODEL,
  thinking: { type: "disabled" },
} as const satisfies Pick<Anthropic.MessageCreateParamsNonStreaming, "model" | "thinking">;

/**
 * All text in a response, by block type rather than position. Empty when the model declined
 * (stop_reason "refusal") or returned no text — callers treat "" as "skip this turn".
 */
export function textOf(msg: Anthropic.Message): string {
  return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

/** Logging may never hold up an agent turn by more than this. */
const LOG_BUDGET_MS = 500;

/** Record the call, but give up waiting after LOG_BUDGET_MS (the insert keeps going in the background). */
async function logBounded(rec: Parameters<typeof recordAiCall>[0]): Promise<void> {
  await Promise.race([recordAiCall(rec), new Promise<void>((resolve) => setTimeout(resolve, LOG_BUDGET_MS))]);
}

/** Same signature as the SDK's `fetch` client option. */
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; // narrowed by the check above
}
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * A fetch that records every Messages API request to AiCallLog (status, error type,
 * token usage, latency) and otherwise behaves exactly like the global fetch.
 * Every SDK retry attempt passes through here, so a 529 followed by a success logs both.
 */
function trackedFetch(route: string, fixedAgent: string | null = null): FetchFn {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isMessages = /\/v1\/messages(\?|$)/.test(url);
    if (!isMessages) return fetch(input, init);

    let model: string | null = null;
    if (typeof init?.body === "string") {
      try { model = str(obj(JSON.parse(init.body))?.model); } catch { /* not JSON — leave null */ }
    }
    const started = Date.now();
    const base = { route, model, agent: fixedAgent ?? currentAgent(), cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0 };

    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (err) {
      await logBounded({
        ...base, ok: false, status: null, errorType: "network",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }

    const durationMs = Date.now() - started;
    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    const body = isJson ? obj(await res.clone().json().catch(() => null)) : null;

    if (res.ok) {
      // Streaming responses (text/event-stream) carry usage in events; token counts stay 0 for those.
      const usage = obj(body?.usage);
      await logBounded({
        ...base,
        ok: true, status: res.status, errorType: null, errorMessage: null, durationMs,
        inputTokens: num(usage?.input_tokens),
        outputTokens: num(usage?.output_tokens),
        cacheReadTokens: num(usage?.cache_read_input_tokens),
        cacheWriteTokens: num(usage?.cache_creation_input_tokens),
      });
    } else {
      const error = obj(body?.error);
      const apiType = str(error?.type);
      const message = str(error?.message);
      await logBounded({
        ...base, ok: false, status: res.status, durationMs,
        errorType: classifyAiError(res.status, apiType, message),
        errorMessage: message ?? `HTTP ${res.status}`,
      });
    }
    return res;
  };
}

/**
 * Anthropic client whose calls show up on the admin AI-health dashboard (/admin/agents).
 * `route` labels where the call came from (e.g. "discuss", "news", "translate").
 */
export function createAnthropic(route: string, agent: string | null = null): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: trackedFetch(route, agent) });
}

const labeledClients = new Map<string, Anthropic>();

/**
 * Cached client whose calls are logged under a "route:purpose" label (e.g. "discuss:isNovel"),
 * so the dashboard's token breakdown shows exactly which code path spends the tokens.
 * `agent` pins the call to an agent when it runs outside a withAgent() turn (e.g. news).
 */
export function anthropicFor(label: string, agent: string | null = null): Anthropic {
  const key = `${label}|${agent ?? ""}`;
  let client = labeledClients.get(key);
  if (!client) {
    client = createAnthropic(label, agent);
    labeledClients.set(key, client);
  }
  return client;
}
