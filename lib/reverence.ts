import { AGENT_MODEL, AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";
import { recordAiCall } from "@/lib/aiCallLog";
import { currentAgent } from "@/lib/agentContext";

/**
 * Reverence check (owner's rule: "Debate or cynicism should never question the Word and God").
 * The prompts already say so (CHIEF_END, FAITH_GUARDRAIL in lib/agents.ts); this makes "never"
 * hold: before an agent's text is posted, a draft that touches God, Scripture, prayer or faith is
 * read once more, and one that questions them, leaves them as an open question, or is cynical
 * about them is not posted.
 *
 *   - A draft that doesn't touch these subjects passes with no model call.
 *   - Otherwise one 10-token call (`faith:check`) answers YES (breaks the rule) or NO.
 *   - It judges the draft's OWN voice. Acknowledging that a person doubts or struggles and
 *     answering from faith is exactly what agents should do, and passes.
 *   - An unreadable answer or an API error passes it (like the other gates) — a failed check must
 *     never silence the agents.
 *   - A refused draft is logged as `faith:rejected` with the agent's name (the dashboard's 최근 실패
 *     list — a refusal, not an outage).
 */

const TOUCHES_FAITH =
  /\b(god|lord|jesus|christ|holy spirit|spirit of god|scripture|scriptures|bible|biblical|gospel|faith|pray|prays|prayed|praying|prayer|prayers|resurrection|heaven|creator|church|christian|christians|christianity|theology|divine|miracle|miracles|salvation)\b|하나님|하느님|주님|예수|그리스도|성령|성경|말씀|복음|믿음|신앙|기도|부활|십자가|천국|창조주|교회|기독교|구원/i;

/** Does the text speak of God, Scripture, prayer or faith at all? (A cheap filter before the model call.) */
export const touchesFaith = (text: string) => TOUCHES_FAITH.test(text);

export function reverencePrompt(text: string): string {
  return `An AI companion in a Christian family's app wrote the text below. The rule for these companions: they never question, doubt or argue against God — the Father, Jesus Christ, the Holy Spirit — or the truth and authority of the Bible; they never treat these as uncertain, or as one opinion among others; and they never speak of God, Scripture, prayer or faith with cynicism, sarcasm or mockery.

Text: "${text.slice(0, 1200)}"

Does the text break the rule?
Answer YES if the text, in its own voice, casts doubt on God or on Scripture, argues against them, leaves whether they are true or good as an open question, or is cynical, sarcastic or flippant about them or about prayer and faith.
Answer NO if it affirms them, or does not really address them; if it acknowledges that someone else doubts or struggles and answers from faith; if it says a passage is hard to understand and then says what it teaches; if it admits not knowing a detail without doubting God; or if it criticises a human argument, idea or behaviour rather than God or His Word.
Reply with only YES or NO.`;
}

export type ReverenceVerdict = { ok: true } | { ok: false; reason: string };

export async function checkReverence(text: string): Promise<ReverenceVerdict> {
  if (!touchesFaith(text)) return { ok: true };
  try {
    const msg = await anthropicFor("faith:check").messages.create({
      ...AGENT_REQUEST,
      max_tokens: 10,
      messages: [{ role: "user", content: reverencePrompt(text) }],
    });
    return textOf(msg).trim().toUpperCase().startsWith("Y") ? { ok: false, reason: "questions, or is cynical about, God or His Word" } : { ok: true };
  } catch {
    return { ok: true };
  }
}

/** The gate: true when the draft may be posted. A refusal is logged as `faith:rejected`. */
export async function honoursGodAndHisWord(text: string): Promise<boolean> {
  const verdict = await checkReverence(text);
  if (verdict.ok) return true;
  void recordAiCall({
    route: "faith:rejected", model: AGENT_MODEL, agent: currentAgent(), ok: false, status: 422,
    errorType: "invalid_request", errorMessage: `${verdict.reason} — draft: ${text.slice(0, 300)}`,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0,
  });
  return false;
}
