import { parseReferences } from "@/lib/scripture";

/**
 * In Korean, agents never put Scripture in quotation marks (SCRIPTURE_RULE in lib/agents.ts).
 * There is no Korean Bible text here to check wording against, and what came out in marks was the
 * agent's own rendering — "왕을 세우시며 왕을 폐하신다"(다니엘 2:21) is not the 개역개정. The prompt
 * alone still left about one text in seven doing it, so the marks come off here, for every agent
 * text (finalizeAgentText).
 *
 * A Korean phrase in double quotation marks, in a sentence that carries a Bible reference (or is
 * followed at once by one in parentheses), becomes plain indirect speech:
 *   "…들으신다"고 말씀합니다 (잠언 15:29)  →  …들으신다고 말씀합니다 (잠언 15:29)
 * The words stay; only the claim that they are the Bible's exact wording goes. English text (NKJV
 * quotations) is left alone, and so is anything quoted in a sentence without a reference — a
 * person's words, a headline.
 */
export function unquoteKoreanScripture(text: string): string {
  if (!HANGUL.test(text) || !/["“”]/.test(text)) return text;
  return text.replace(QUOTED, (whole: string, inner: string, rago: string | undefined, at: number) => {
    if (!HANGUL.test(inner)) return whole;
    if (parseReferences(sentenceAround(text, at, at + whole.length)).length === 0) return whole;
    const body = inner.replace(/[.。]\s*$/, "");
    if (!rago) return body;
    // "…있다"라고 → …있다고; after any other ending the particle stays as written.
    return body.endsWith("다") ? `${body}고` : `${body}라고`;
  });
}

const HANGUL = /[가-힣]/;
const QUOTED = /["“]([^"“”\n]{2,200})["”](라고)?/g;

/** The sentence holding text[from..to), plus a parenthesis that follows its full stop — "….” (시편 23:1)". */
function sentenceAround(text: string, from: number, to: number): string {
  let start = 0;
  for (const m of text.slice(0, from).matchAll(/[.!?。]\s|\n/g)) start = (m.index ?? 0) + m[0].length;
  const end = text.slice(to).search(/[.!?。](?=\s|$)|\n/);
  let stop = end === -1 ? text.length : to + end + 1;
  const trailing = text.slice(stop).match(/^[ \t]*\([^()\n]{0,80}\)/); // same line only
  if (trailing) stop += trailing[0].length;
  return text.slice(start, stop);
}
