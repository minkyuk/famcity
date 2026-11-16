import { cleanFeedText, storyKeywords } from "@/lib/newsFormat";

/**
 * Best-effort article body for the news brief. A feed's <description> is one or two sentences,
 * which rarely says when, where, why and how — the article page usually does. Everything here
 * fails soft: no body just means the brief is written from the feed summary.
 */

const BLOCKS_TO_DROP = /<(script|style|noscript|nav|header|footer|aside|figure|form|svg|iframe|button)\b[\s\S]*?<\/\1>/gi;
const BOILERPLATE = /cookie|subscribe|newsletter|sign up|sign in|all rights reserved|copyright|advertisement|follow us|read more|click here|privacy policy|terms of (use|service)|무단\s*전재|재배포\s*금지|구독/i;
const SENTENCE_END = /[.!?。…"”’)]$|다\.?$/;

/** Length that counts a Hangul syllable twice: Korean says in 30 characters what English says in 60. */
const weight = (t: string) => t.length + (t.match(/[\uAC00-\uD7A3]/g)?.length ?? 0);

/**
 * Pulls readable paragraphs out of an article page. Returns "" when there isn't enough real text.
 * `maxWeight` bounds the prompt cost (see weight()).
 */
export function extractArticleText(html: string, maxWeight = 2400): string {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, " ").replace(BLOCKS_TO_DROP, " ");
  // Prefer the article element; many pages wrap related links and comments outside it.
  const open = stripped.search(/<article\b/i);
  const close = stripped.toLowerCase().lastIndexOf("</article>");
  const scope = open !== -1 && close > open ? stripped.slice(open, close) : stripped;

  const paragraphs: string[] = [];
  let total = 0;
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  for (let m = re.exec(scope); m; m = re.exec(scope)) {
    const text = cleanFeedText(m[1]);
    if (weight(text) < 60 || BOILERPLATE.test(text) || !SENTENCE_END.test(text)) continue;
    if (paragraphs.includes(text)) continue;
    if (total + weight(text) > maxWeight) break;
    paragraphs.push(text);
    total += weight(text) + 1;
  }
  return total >= 300 ? paragraphs.join(" ") : "";
}

/** True when the text plausibly belongs to the headline (guards against consent walls and wrong pages). */
export function matchesHeadline(text: string, title: string): boolean {
  const keys = [...storyKeywords(title)];
  if (keys.length < 2) return true;
  const lower = text.toLowerCase();
  return keys.filter((k) => lower.includes(k)).length >= 2;
}

export async function fetchArticleText(url: string, title: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FamCityNews/1.0)", Accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const text = extractArticleText((await res.text()).slice(0, 1_500_000));
    return text && matchesHeadline(text, title) ? text : null;
  } catch {
    return null; // timeout, blocked, not HTML — the feed summary is used instead
  }
}
