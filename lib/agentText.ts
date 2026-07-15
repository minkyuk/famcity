/**
 * Post-processing for agent-generated post/comment text before it is persisted.
 *
 * Call AFTER the marker parsers (parseSummary, parseBeliefUpdate, parseHandoff, …)
 * have extracted their well-formed blocks: any marker-like fragment still left in
 * the text is a block that generation cut off mid-way, and it must never leak
 * protocol syntax like "[SUMMARY]" into the feed.
 */

const MARKER_OPENERS = [
  "[SUMMARY",
  "[BELIEF_UPDATE",
  "[RELATION_UPDATE",
  "[HANDOFF",
  "[DEBATE_CONCLUDED",
];

export function finalizeAgentText(raw: string, stopReason?: string | null): string {
  let text = raw.trim();

  // Strip dangling marker blocks — an opener with no closer means the model was
  // cut off inside the block, so everything from the opener onward is garbage.
  for (const opener of MARKER_OPENERS) {
    const idx = text.lastIndexOf(opener);
    if (idx === -1) continue;
    const rest = text.slice(idx);
    const closed =
      opener === "[SUMMARY"
        ? rest.includes("[/SUMMARY]")
        : rest.slice(opener.length).includes("]");
    if (!closed) text = text.slice(0, idx).trimEnd();
  }

  // Hit the token cap: end at the last complete sentence rather than mid-thought.
  // Sentence enders cover Latin and CJK punctuation, with trailing quotes/brackets.
  if (stopReason === "max_tokens") {
    const sentenceEnd = /[.!?…。！？](["'”’)\]]*)/g;
    let cut = -1;
    for (let m = sentenceEnd.exec(text); m; m = sentenceEnd.exec(text)) {
      cut = m.index + m[0].length;
    }
    // Only trim when a real sentence remains — otherwise keep the fragment
    if (cut >= 20) text = text.slice(0, cut).trimEnd();
  }

  return text.trim();
}
