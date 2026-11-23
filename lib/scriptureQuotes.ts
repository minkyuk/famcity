import { parseReferences } from "@/lib/scripture";

/**
 * In Korean, agents never put Scripture in quotation marks (SCRIPTURE_RULE in lib/agents.ts).
 * There is no Korean Bible text here to check wording against, and what came out in marks was the
 * agent's own rendering — "왕을 세우시며 왕을 폐하신다"(다니엘 2:21) is not the 개역개정. The prompt
 * alone still left about one text in seven doing it, so the marks come off here, for every agent
 * text (finalizeAgentText).
 *
 * A Korean phrase in quotation marks, in a sentence that carries a Bible reference (or is followed
 * at once by one in parentheses), loses the marks and reads as indirect speech:
 *   "…들으신다"고 말씀합니다 (잠언 15:29)  →  …들으신다고 말씀합니다 (잠언 15:29)
 * The words stay — particles included, exactly as written: turning "…합니다"라고 into 합니다고, or
 * "…이다"라고 into 이다고, would be wrong Korean. Only the claim that these are the Bible's exact
 * words goes.
 *
 * Left alone: English text (NKJV quotations), and anything quoted in a sentence without a
 * reference — a person's words, a headline. A person's words that share a sentence with a
 * reference do lose their marks ("내일 가자"고 하셨고, 잠언 3:5가 … → 내일 가자고 하셨고 …), which
 * still reads correctly.
 */
export function unquoteKoreanScripture(text: string): string {
  if (text.length > MAX_TEXT || !HANGUL.test(text) || !ANY_MARK.test(text)) return text;
  return text.split("\n").map(unquoteLine).join("\n");
}

/** Agent text is a few thousand characters at most; anything far beyond that is not ours to rewrite. */
const MAX_TEXT = 20_000;
const HANGUL = /[가-힣]/;
const ANY_MARK = /["“‘']/;
// "…" · “…” · ‘…’ · '…' — a straight single mark only where it cannot be an apostrophe (don't, it's).
const QUOTED = /"([^"\n]{2,400})"|“([^“”\n]{2,400})”|‘([^‘’\n]{2,400})’|(?<![A-Za-z0-9])'([^'\n]{2,400})'(?![A-Za-z])/g;

function unquoteLine(line: string): string {
  // One parse per line settles most text at once: no reference on the line, nothing to do.
  if (!HANGUL.test(line) || parseReferences(line).length === 0) return line;
  // An odd number of straight marks means one of them is not a quotation mark; pairing them up
  // would join the wrong pieces, so that kind of mark is left alone on this line.
  const paired = (mark: string) => (line.split(mark).length - 1) % 2 === 0;
  const doubleOk = paired('"');
  const singleOk = paired("'");

  return line.replace(QUOTED, (whole: string, double: string | undefined, curly: string | undefined, curlySingle: string | undefined, single: string | undefined, at: number) => {
    if ((double !== undefined && !doubleOk) || (single !== undefined && !singleOk)) return whole;
    const inner = double ?? curly ?? curlySingle ?? single ?? "";
    if (!HANGUL.test(inner)) return whole;
    const end = at + whole.length;
    if (parseReferences(sentenceAround(line, at, end)).length === 0) return whole;
    // "…사랑하느냐?"고 → …사랑하느냐고: closing punctuation goes only when a particle is attached.
    return HANGUL.test(line[end] ?? "") ? inner.replace(/[.?!。]\s*$/, "") : inner;
  });
}

/** The sentence holding line[from..to), plus a parenthesis right after its full stop — "…다." (시편 23:1). */
function sentenceAround(line: string, from: number, to: number): string {
  let start = 0;
  for (const m of line.slice(0, from).matchAll(/[.!?。]\s/g)) start = (m.index ?? 0) + m[0].length;
  const end = line.slice(to).search(/[.!?。](?=\s|$)/);
  let stop = end === -1 ? line.length : to + end + 1;
  const trailing = line.slice(stop).match(/^[ \t]*\([^()]{0,80}\)/);
  if (trailing) stop += trailing[0].length;
  return line.slice(start, stop);
}
