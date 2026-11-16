import { cleanFeedText, storyKeywords } from "@/lib/newsFormat";

/**
 * Best-effort article body for the news brief. A feed's <description> is one or two sentences,
 * which rarely says when, where, why and how — the article page usually does. Everything here
 * fails soft: no body just means the brief is written from the feed summary.
 */

/** Pages are read as a stream and cut off here, so a huge or endless response can't exhaust memory. */
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
/** One paragraph of real article text is never this long; anything bigger is markup soup. */
const MAX_PARAGRAPH_SOURCE = 6000;

/** Elements whose content is not markup: skipped straight to their closing tag. */
const RAW_TEXT = new Set(["script", "style", "noscript", "template", "textarea"]);
/** Page furniture: paragraphs inside these are ignored. */
const DROPPED = new Set(["nav", "header", "footer", "aside", "figure", "form", "svg", "iframe", "button"]);
/** Tags that can sit inside a paragraph without ending it. */
const INLINE = new Set(["a", "b", "i", "em", "strong", "span", "u", "sub", "sup", "small", "mark", "abbr", "cite", "q", "time", "br", "wbr", "code"]);

const BOILERPLATE = /cookie|subscribe|newsletter|sign up|sign in|all rights reserved|copyright|advertisement|follow us|read more|click here|privacy policy|terms of (use|service)|무단\s*전재|재배포\s*금지|구독/i;
const SENTENCE_END = /[.!?。…"”’)]$|다\.?$/;

/** Length that counts a Hangul syllable twice: Korean says in 30 characters what English says in 60. */
const weight = (t: string) => t.length + (t.match(/[가-힣]/g)?.length ?? 0);

type RawParagraph = { source: string; inArticle: boolean };

/**
 * One forward pass over the tags. Deliberately not a set of "<tag>…</tag>" regexes: on malformed
 * pages (unclosed tags) those backtrack quadratically, and nothing can interrupt a regex.
 */
function scanParagraphs(html: string): RawParagraph[] {
  const out: RawParagraph[] = [];
  const tagRe = /<!--|<(\/?)([a-z][a-z0-9]*)/gi;
  let dropDepth = 0;
  let articleDepth = 0;
  let start = -1;
  let startInArticle = false;
  const endParagraph = (at: number) => {
    if (start !== -1) out.push({ source: html.slice(start, at), inArticle: startInArticle });
    start = -1;
  };

  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    if (m[0] === "<!--") {
      const end = html.indexOf("-->", tagRe.lastIndex);
      if (end === -1) break;
      tagRe.lastIndex = end + 3;
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const gt = html.indexOf(">", tagRe.lastIndex);
    if (gt === -1) break;
    tagRe.lastIndex = gt + 1;
    if (INLINE.has(name)) continue;

    endParagraph(m.index);
    const selfClosing = html[gt - 1] === "/";
    if (RAW_TEXT.has(name)) {
      if (closing || selfClosing) continue;
      const closeRe = new RegExp(`</${name}`, "gi");
      closeRe.lastIndex = gt + 1;
      const close = closeRe.exec(html);
      if (!close) break;
      tagRe.lastIndex = close.index;
    } else if (DROPPED.has(name)) {
      if (!selfClosing) dropDepth = Math.max(0, dropDepth + (closing ? -1 : 1));
    } else if (name === "article") {
      articleDepth = Math.max(0, articleDepth + (closing ? -1 : 1));
    } else if (name === "p" && !closing && dropDepth === 0) {
      start = gt + 1;
      startInArticle = articleDepth > 0;
    }
  }
  return out;
}

/**
 * Pulls readable paragraphs out of an article page. Returns "" when there isn't enough real text.
 * `maxWeight` bounds the prompt cost (see weight()).
 */
export function extractArticleText(html: string, maxWeight = 2400): string {
  const all = scanParagraphs(html);
  // Prefer the article element; many pages put related links and comments outside it.
  const scoped = all.some((p) => p.inArticle) ? all.filter((p) => p.inArticle) : all;

  const paragraphs: string[] = [];
  let total = 0;
  for (const p of scoped) {
    if (p.source.length > MAX_PARAGRAPH_SOURCE) continue;
    const text = cleanFeedText(p.source);
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

/**
 * Feed links are third-party input, so only ordinary public web addresses are fetched: no IP
 * literals (cloud metadata, loopback), no single-label or internal names, no credentials or odd
 * ports. Redirects are followed by hand so every hop passes the same check. (A public name that
 * resolves to a private address is not caught here.)
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^[0-9.]+$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return out;
}

export async function fetchArticleText(url: string, title: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(timeoutMs); // one budget for the whole chain of redirects
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPublicHttpUrl(current)) return null;
      const res = await fetch(current, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FamCityNews/1.0)", Accept: "text/html" },
        redirect: "manual",
        signal,
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
      const text = extractArticleText(await readCapped(res, MAX_BYTES));
      return text && matchesHeadline(text, title) ? text : null;
    }
    return null; // too many redirects
  } catch {
    return null; // timeout, blocked, bad URL — the feed summary is used instead
  }
}
