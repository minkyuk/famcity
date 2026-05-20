/**
 * Lightweight text similarity utilities for agent dedup.
 * Used as a fast pre-filter before calling Haiku quality gates.
 */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Returns overlapping bigrams (word pairs) as a Set<string>. */
function bigrams(tokens: string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    result.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
}

function jaccardBigrams(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const g of a) if (b.has(g)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns true if `proposed` is textually too similar to any of the `existing` texts.
 * Uses bigram Jaccard similarity — catches paraphrase-level duplicates quickly without
 * an API call. Threshold ~0.30 = ~30% bigram overlap, which catches close rewording.
 */
export function isTextualDuplicate(
  proposed: string,
  existing: string[],
  threshold = 0.30
): boolean {
  const pTokens = tokenize(proposed);
  if (pTokens.length < 4) return false; // too short to compare meaningfully
  const pBi = bigrams(pTokens);
  for (const text of existing) {
    const eBi = bigrams(tokenize(text));
    if (jaccardBigrams(pBi, eBi) >= threshold) return true;
  }
  return false;
}
