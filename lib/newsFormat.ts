/**
 * Family News post format (v2). Pure helpers: prompts, defensive parsing, assembly.
 *
 * Every post opens with the headline and a TL;DR (English + Korean), then the 5W1H facts taken
 * only from the source text, then two perspectives in a fixed order: the God-centered reading
 * first, and after it a human-standards reading that states the progressive and the conservative
 * view fairly — without manufacturing a conflict the story doesn't have.
 */

export type NewsLang = "en" | "ko";

export type NewsStory = {
  sourceName: string;
  title: string;
  description: string;
  /** Article URL from the feed, if it had one. */
  link: string | null;
  /** When the feed says it was published; null when the feed's date was unusable. */
  publishedAt: Date | null;
  /** Body text fetched from the article page (best effort) — gives the brief more than the feed's one-line summary. */
  articleText?: string | null;
  /** The same event as reported by other outlets: cited in the post and used to cross-check the facts. */
  others?: OtherReport[];
};

export type OtherReport = { sourceName: string; link: string | null; description: string };

/** At most this many other outlets are cited and quoted to the model per story. */
const MAX_OTHER_REPORTS = 3;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

function decodeEntities(s: string): string {
  const fromCode = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => fromCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

/**
 * Feed titles and summaries arrive with CDATA wrappers, escaped HTML and entities ("Fed&#x27;s",
 * "&lt;p&gt;…"). The headline is shown verbatim in the post, so it has to be plain text.
 */
export function cleanFeedText(raw: string): string {
  // Tag-shaped only (<p>, </a>, <img src=…>): a headline's "<1%" or "a < b" is text, not markup.
  const stripTags = (s: string) => s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/gi, " ");
  // Feeds either wrap HTML in CDATA or escape it (&lt;p&gt;…), so: strip, decode, strip what the
  // decode revealed, then decode what that HTML had escaped itself. The last decode is not
  // stripped again — a "<" it produces was meant as a character.
  const once = stripTags(decodeEntities(stripTags(raw.replace(/<!\[CDATA\[|\]\]>/g, ""))));
  return decodeEntities(once).replace(/\s+/g, " ").trim();
}

/** Only http(s) links are shown; a feed's <guid> fallback is often not a URL. */
export function cleanFeedLink(raw: string): string | null {
  const link = cleanFeedText(raw);
  if (!/^https?:\/\/\S+$/i.test(link)) return null;
  try {
    const url = new URL(link);
    // Feed tracking tags make the link long and say nothing to the reader.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|at_|ns_)|^(cmpid|ocid|src|ref|tsrc|traffic_source|partner|smid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export const KOREAN_NEWS_BADGE = "🇰🇷 한국 뉴스";

// Built with the constructor: \p{…} in a literal needs a newer compile target than this project's.
const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "u");
const HANGUL = /[\uAC00-\uD7A3]/;

/** Trailing particles ("대통령은" / "대통령이") — removed so the same word matches across titles. */
const KOREAN_PARTICLE = /(에서|으로|부터|까지|은|는|이|가|을|를|의|에|도|로|과|와)$/;

/** Long enough to pass the five-letter rule, but they say nothing about which story it is. */
const FILLER_WORDS = new Set([
  "after", "about", "their", "there", "which", "while", "where", "would", "could", "should", "these", "those",
  "other", "being", "under", "since", "until", "against", "between", "among", "before", "during", "first",
  "again", "still", "every", "might", "amid",
]);

/** Words that identify a story. Korean words are short, so two syllables count; Latin words need five letters. */
export function storyKeywords(title: string): Set<string> {
  const words = title.toLowerCase().split(NON_WORD).map((w) =>
    HANGUL.test(w) && w.length >= 3 ? w.replace(KOREAN_PARTICLE, "") : w,
  );
  return new Set(words.filter((w) => (HANGUL.test(w) ? w.length >= 2 : w.length > 4 && !FILLER_WORDS.has(w))));
}

/**
 * Same story when three keywords are shared. A title with only two keywords matches when both
 * are shared; two out of three is not enough ("서울 지하철 파업" vs "서울 지하철 화재").
 */
export function isSameStory(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const ka = storyKeywords(a);
  const kb = storyKeywords(b);
  let overlap = 0;
  for (const w of ka) if (kb.has(w)) overlap++;
  return overlap >= 3 || (overlap === 2 && Math.min(ka.size, kb.size) === 2);
}

/** The headline a stored news post was written about (its first line, without the 📰 mark and badge). */
export function headlineOfPost(content: string): string {
  const first = (content.split("\n")[0] ?? "").replace(/^📰\s*/u, "").trim();
  if (first === KOREAN_NEWS_BADGE) return ""; // old format: the badge alone was line 1
  return first.endsWith(` · ${KOREAN_NEWS_BADGE}`) ? first.slice(0, -` · ${KOREAN_NEWS_BADGE}`.length).trim() : first;
}

/**
 * Outlets headline the same event in different words ("California files lawsuit against OpenAI…"
 * / "California sues OpenAI over hacking risks"), which keyword matching misses. With many outlets
 * that would post one event several times, so one short call reads the headlines and says which
 * are the same event — as each other, and as something already posted.
 */
export function groupPrompt(headlines: string[], posted: string[]): string {
  return `Below are news headlines from different outlets (numbered)${posted.length > 0 ? ", followed by headlines that were already posted (P-numbered)" : ""}.

1. Which numbered headlines report the SAME EVENT as each other? Group them only when it is clearly the same event — the same people, the same action, the same occasion. The same topic, country or person is not enough.
2. Which numbered headlines report the same event as an already-posted headline?

Answer ONLY with JSON, no other text: {"groups": [[0, 5, 12], [3, 9]], "posted": [4, 7]}
Use [] where there is nothing to report.

Headlines:
${headlines.map((h, i) => `${i}. ${h.slice(0, 140)}`).join("\n")}${posted.length > 0 ? `\n\nAlready posted:\n${posted.map((h, i) => `P${i}. ${h.slice(0, 140)}`).join("\n")}` : ""}`;
}

/** Reads groupPrompt's reply. Anything malformed or out of range is ignored — a bad answer groups nothing. */
export function parseGroups(raw: string, count: number): { linked: number[][]; posted: number[] } {
  const none = { linked: [], posted: [] };
  const match = plain(raw).match(/\{[\s\S]*\}/);
  if (!match) return none;
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return none; }
  if (typeof parsed !== "object" || parsed === null) return none;
  const o = parsed as Record<string, unknown>; // a non-null object from model JSON, read field by field
  const indexes = (v: unknown): number[] =>
    Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count))] : [];
  const linked = (Array.isArray(o.groups) ? o.groups : []).map(indexes).filter((g) => g.length >= 2);
  return { linked, posted: indexes(o.posted) };
}

/**
 * The Korean feed is a raw "latest" wire: company filings and notices sit next to real news, so
 * the first item is often trivial. One short call picks the story worth telling a family — or none.
 */
export function koreanPickPrompt(stories: { title: string; description: string; sourceName?: string; others?: OtherReport[] }[]): string {
  const list = stories.map((s, i) => {
    const outlets = [s.sourceName, ...(s.others ?? []).map((o) => o.sourceName)].filter(Boolean);
    return `${i}. ${s.title}${outlets.length > 0 ? ` (${outlets.join(", ")})` : ""}${s.description ? ` — ${s.description.slice(0, 80)}` : ""}`;
  }).join("\n");
  return `아래는 방금 들어온 한국 뉴스입니다. 한국어를 쓰는 한 가족에게 오늘 전할 만한, 사회 전체에 의미가 큰 소식 하나를 고르세요.

고르지 말 것: 개별 기업의 공시·주식 취득·실적 발표, 인사·부고·게시판, 스포츠 경기 결과, 연예 소식, 날씨 예보, 홍보성 기사.
여러 매체가 함께 다룬 소식이 있으면 그것을 우선하세요. 고를 만한 소식이 없으면 NONE 이라고 답하세요.

${list}

번호 하나만 답하세요 (예: 3). 고를 것이 없으면 NONE.`;
}

/** Index chosen by koreanPickPrompt's reply; null for NONE, an out-of-range number, or anything unreadable. */
export function parsePick(raw: string, count: number): number | null {
  const m = raw.trim().match(/^\D{0,12}(\d{1,2})\b/);
  if (!m || /none/i.test(raw)) return null;
  const index = Number(m[1]);
  return index >= 0 && index < count ? index : null;
}

/** Cuts at a word boundary and marks the cut, for one-line fields such as the vote reason. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:—-]+$/, "")}…`;
}

/** A story is posted only when at least this many voters chose it. */
export const MIN_VOTES_TO_POST = 2;

const BRIEF_FIELDS = ["tldr", "who", "what", "when", "where", "why", "how", "helps", "hurts"] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
export type Brief = Partial<Record<BriefField, string>>;

/** Label the model writes (first alias) and the variants we accept back. */
const ALIASES: Record<NewsLang, Record<BriefField, string[]>> = {
  en: {
    tldr: ["TLDR", "TL;DR", "TL; DR", "SUMMARY"],
    who: ["WHO"], what: ["WHAT"], when: ["WHEN"], where: ["WHERE"], why: ["WHY"], how: ["HOW"],
    helps: ["HELPS", "GAINS", "BENEFITS", "WINNERS"],
    hurts: ["HURTS", "LOSES", "COSTS", "LOSERS"],
  },
  ko: {
    tldr: ["요약", "TL;DR", "TLDR"],
    who: ["누가"], what: ["무엇을", "무엇"], when: ["언제"], where: ["어디서", "어디에서"], why: ["왜"], how: ["어떻게"],
    helps: ["도움", "도움이 되는 쪽", "이득", "수혜"],
    hurts: ["부담", "부담이 되는 쪽", "손해", "피해"],
  },
};

/** Label shown in the post. */
const DISPLAY: Record<NewsLang, Record<BriefField, string>> = {
  en: { tldr: "TL;DR", who: "Who", what: "What", when: "When", where: "Where", why: "Why", how: "How", helps: "➕ Helps", hurts: "➖ Hurts" },
  ko: { tldr: "요약", who: "누가", what: "무엇을", when: "언제", where: "어디서", why: "왜", how: "어떻게", helps: "➕ 도움이 되는 쪽", hurts: "➖ 부담이 되는 쪽" },
};

export const NOT_STATED: Record<NewsLang, string> = { en: "Not stated in the source", ko: "출처에 없음" };
/** What the balance lines say when a story has no clear winner (or loser) — the model is told not to force one. */
export const NO_CLEAR_PARTY: Record<NewsLang, string> = { en: "No clear party", ko: "뚜렷한 대상 없음" };
/** Labels from the earlier format: recognised so a stray "IMPACT:" line isn't glued onto the line before it. */
const RETIRED_LABELS: Record<NewsLang, string[]> = { en: ["IMPACT"], ko: ["영향"] };
const BALANCE_TITLE: Record<NewsLang, string> = { en: "📊 Who gains, who loses", ko: "📊 득실 — 누구에게 도움이 되고 누구에게 부담인가" };

export function formatPublished(d: Date | null): string | null {
  if (!d || d.getTime() <= 0) return null;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Prompt for the factual brief. No persona: this part reports, it doesn't opine. */
export function briefPrompt(lang: NewsLang, story: NewsStory): string {
  const published = formatPublished(story.publishedAt);
  const own = story.articleText
    ? `${story.description.slice(0, 500)}\n${story.articleText}`
    : story.description.slice(0, 700);
  const others = (story.others ?? []).slice(0, MAX_OTHER_REPORTS);
  // Other outlets' summaries count as source text too: no outlet's framing is taken on trust.
  const text = others.length === 0 ? own : `${own}\n\n${lang === "ko"
    ? "같은 사건에 대한 다른 매체의 요약 (사실 확인과 보충에 쓰고, 매체마다 내용이 다르면 어느 매체가 그렇게 전하는지 밝히세요):"
    : "OTHER OUTLETS ON THE SAME STORY (use their summaries to confirm and add facts; where outlets differ, say which outlet reports what):"}\n${others.map((o) => `- ${o.sourceName}: ${o.description.slice(0, 300)}`).join("\n")}`;
  if (lang === "ko") {
    return `가족을 위한 사실 중심 뉴스 브리핑을 한국어로 작성하세요. 아래 출처 본문에 적힌 사실만 사용하세요 (마지막 두 줄 "도움"·"부담"만 예외로, 그 사실에서 바로 따라오는 결과를 정리합니다). 본문에 없는 이름, 숫자, 날짜, 장소, 원인, 동기를 절대 추가하지 마세요. 본문에 없는 항목은 정확히 "${NOT_STATED.ko}"이라고만 쓰고 다른 설명을 붙이지 마세요. 본문에 제목과 관계없는 줄(광고, 다른 기사 안내)이 섞여 있으면 무시하세요.

출처: ${story.sourceName}${published ? `\n게시 시각: ${published}` : ""}
제목: ${story.title}
본문: ${text}

작성 규칙:
- 각 줄은 짧은 한 문장(70자 이내)으로, 가장 중요한 것만 쓰세요. 요약만 두 문장까지 가능합니다.
- 사실을 바로 서술하세요. "본문에 따르면", "출처는 ~라고 전한다" 같은 표현이나 본문에 대한 평가, 괄호 속 원문 인용을 쓰지 마세요.
- 확인되지 않은 주장은 누가 한 주장인지 밝히세요 (예: "소송은 ~라고 주장한다", "경찰은 ~라고 밝혔다").
- 외국 인명·기관명은 한글로 쓰고, 처음 한 번만 원어를 괄호로 덧붙이세요.
- "도움"과 "부담" 두 줄은 이 소식의 득실을 객관적으로 정리하는 곳입니다. 줄마다 구체적인 대상(집단·기업·국가)을 최대 세 곳 쓰고, 대상 뒤에 " — "와 함께 어떻게 도움이 되거나 부담이 되는지 적으세요 (예: "예금자 — 예금 이자 상승; 수출 기업 — 환율 효과"). 이 두 줄은 110자까지 쓸 수 있습니다. 위 사실에서 바로 따라오는 결과만 쓰고, 본문에 없는 숫자나 추측을 덧붙이지 말며, 칭찬이나 비난 없이 서술하세요. 확실하지 않은 효과는 "~할 수 있음"으로 쓰세요. 거의 모든 소식은 누군가의 입지(돈·권한·안전·평판)를 유리하게 하고 다른 누군가에게는 불리하게 하므로 양쪽을 구체적으로 찾으세요. 위 사실만으로는 정말 대상을 짚을 수 없을 때에만 정확히 "${NO_CLEAR_PARTY.ko}"이라고 쓰세요.

아래 아홉 줄을 이 순서대로, 한 줄에 하나씩, 일반 텍스트로만 쓰세요 (마크다운·별표 금지):
요약: 가장 중요한 사실 (핵심 수치가 있으면 그것부터)
누가: 관련된 사람, 기관, 국가
무엇을: 무슨 일이 일어났는지
언제: 일어난 때. 본문에 날짜가 없으면 ${published ? `"${published} 보도"` : `"${NOT_STATED.ko}"`}라고만 쓰세요
어디서: 일어난 곳
왜: 본문에 나온 원인이나 이유
어떻게: 어떤 방식으로 일어났거나 진행되는지
도움: 이 소식이 도움이 되는 쪽과 그 이유
부담: 이 소식이 부담이 되는 쪽과 그 이유`;
  }
  return `Write a factual news brief for a family. Use ONLY facts stated in the source text below (the last two lines, HELPS and HURTS, are the one exception: they set out what follows directly from those facts). Never add a name, number, date, place, cause or motive that is not in it. If the text does not state an element, write exactly "${NOT_STATED.en}" and nothing more on that line. Ignore any lines in the text that are not about the headline story (ads, links to other stories).

SOURCE: ${story.sourceName}${published ? `\nPUBLISHED: ${published}` : ""}
HEADLINE: ${story.title}
TEXT: ${text}

Rules:
- Each line is ONE short sentence (25 words at most) with only the most important point. The TLDR alone may be two sentences.
- State the facts directly. Do not write "the text says" or "according to the source", do not comment on what the source leaves out, and do not quote the text in parentheses.
- Keep unproven claims attributed to whoever made them ("the lawsuit alleges…", "police say…").
- HELPS and HURTS are the objective balance sheet of this news. On each line name up to three specific parties (groups, companies, countries) and, after a dash, the concrete way it helps or costs them ("Savers — higher interest on deposits; Exporters — a weaker currency"). These two lines may run to 40 words. Direct consequences of the facts above only: no speculation beyond them, no numbers that are not in the text, no praise or blame; say "may" where the effect is not certain. Nearly every story strengthens someone's position and weakens someone else's — in money, power, safety or reputation — so look for both sides concretely; only when you truly cannot name a party from the facts, write exactly "${NO_CLEAR_PARTY.en}".

Write exactly these nine lines in this order, one per line, plain text only (no markdown, no asterisks):
TLDR: the most important fact (lead with the key number if there is one)
WHO: the people, organisations or countries involved
WHAT: what happened
WHEN: when it happened; if the text gives no date, write only ${published ? `"Reported ${published}"` : `"${NOT_STATED.en}"`}
WHERE: where it happened
WHY: the cause or reason given in the text
HOW: how it happened or how it will work
HELPS: who this news is good for, and why
HURTS: who this news is bad for, and why`;
}

/** Models sometimes bold the labels despite being told not to. */
const plain = (s: string) => s.replace(/\*\*|__|`/g, "");

/** Parses "LABEL: value" lines (value may wrap onto following lines). Unknown lines before the first label are ignored. */
export function parseBrief(lang: NewsLang, raw: string): Brief {
  const aliasToField = new Map<string, BriefField>();
  for (const f of BRIEF_FIELDS) for (const a of ALIASES[lang][f]) aliasToField.set(a.toLowerCase(), f);
  const labels = [...aliasToField.keys()].sort((a, b) => b.length - a.length).map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const lineRe = new RegExp(`^\\s*(?:[-•*➕➖+]\\s*)?(${labels.join("|")})\\s*[:：]\\s*(.*)$`, "i");
  const retiredRe = new RegExp(`^\\s*(?:[-•*]\\s*)?(${RETIRED_LABELS[lang].join("|")})\\s*[:：]`, "i");

  const out: Brief = {};
  let current: BriefField | null = null;
  for (const line of plain(raw).split("\n")) {
    const m = line.match(lineRe);
    if (m) {
      current = aliasToField.get(m[1].toLowerCase()) ?? null;
      if (current && out[current] === undefined) out[current] = m[2].trim();
      else current = null; // repeated label: keep the first value
    } else if (retiredRe.test(line)) {
      current = null;
    } else if (current && line.trim()) {
      out[current] = `${out[current]} ${line.trim()}`.trim();
    }
  }
  for (const f of BRIEF_FIELDS) if (out[f] !== undefined && out[f] === "") delete out[f];
  return out;
}

const isNotStated = (v: string | undefined) => {
  const t = (v ?? "").trim().toLowerCase().replace(/[."']/g, "");
  return !t || t.startsWith(NOT_STATED.en.toLowerCase()) || t.startsWith(NOT_STATED.ko);
};

/**
 * A brief is usable when it has a TL;DR, says what happened, and states at least three of the
 * 5W1H facts for real — "Not stated in the source" lines are shown, but they don't count.
 */
export function briefIsUsable(b: Brief): boolean {
  const facts = (["who", "what", "when", "where", "why", "how"] as const).filter((f) => !isNotStated(b[f])).length;
  return !isNotStated(b.tldr) && !isNotStated(b.what) && facts >= 3;
}

/**
 * A brief is label lines, not prose: when generation hit the token cap, the last line is the
 * unfinished one, so it is dropped (trimming to the last "." would cut inside "3.5%").
 */
export function dropUnfinishedLine(text: string, stopReason: string | null | undefined): string {
  return stopReason === "max_tokens" ? text.split("\n").slice(0, -1).join("\n") : text;
}

type Persona = { name: string; personality: string };

const storyBlock = (s: NewsStory) =>
  `News (${s.sourceName}): ${s.title}\n${s.description.slice(0, 500)}${s.articleText ? `\n${s.articleText.slice(0, 700)}` : ""}`;

const BILINGUAL = `Write it twice — first in English, then the same content in natural Korean — in exactly this format:\n[EN]\n<English>\n[KO]\n<한국어>`;

/**
 * The Korean half of a reading is "the same content in Korean", so an English quotation used to
 * come out translated inside quotation marks — words that are neither the NKJV nor the 개역개정
 * (one was even labelled "NKJV 취지"). The Scripture check can't catch it: it judges meaning.
 */
export const KOREAN_QUOTATION_RULE = `In Korean, quotation marks go only around the 개역개정's own wording: never put your own Korean translation of a verse, or of an English quotation, in quotation marks. When you are not sure of the 개역개정 wording, say in Korean what the verse teaches, without quotation marks, and give the bare reference, as in (잠언 11:28). In either language a paraphrase carries only its reference, as in (Psalm 11:5) — no NKJV mark, and no remark about which translation you used or whether you are quoting or summarising.`;

/** The God-centered reading: always written first, never party-political. */
export function godViewPrompt(agent: Persona, story: NewsStory, langs: "both" | "ko", guardrail: string): string {
  return `${agent.personality}

${storyBlock(story)}

Write the God-centered reading of this story for a Christian family. This comes first, before any human opinion. Start from who God is and what Scripture actually teaches — His justice and mercy, His truth, His care for the poor and the stranger, the worth of every person made in His image, His rule over nations and history — and say what that means for how to see THIS event and how to pray about it. Be specific to this story: a reading that would fit any news item is not good enough.

The aim is that the family reading this fears the Lord, gives Him the glory and is drawn nearer to Him through this news — not that they admire the commentary.

Scripture: look for the passage that speaks to this kind of situation in particular and bring it with its reference (book, chapter and verse). Quote its words only if you are sure of them exactly, in quotation marks; otherwise say what it teaches in your own words and give the reference. ${KOREAN_QUOTATION_RULE} Do not reach for the most-quoted verses by reflex (Micah 6:8, Jeremiah 29:11, Romans 8:28, Proverbs 3:5) — use one only when it is truly about this. If no passage clearly applies, speak plainly from God's character instead. Write only the reading itself: never mention these instructions, a verse you chose not to use, or how you are citing.

No party politics. Use only the facts in the news text above; add no new facts. 2–4 sentences, 80 words at most in English. No hashtags, no markdown, do not start with "I".

${langs === "ko" ? "한국어로만 작성하세요." : BILINGUAL}${guardrail}`;
}

/**
 * The human-standards reading. Both political views are stated fairly when people really are split
 * on the story; when they aren't, the agent says so instead of manufacturing a conflict.
 */
export function humanViewPrompt(agent: Persona, story: NewsStory, langs: "both" | "ko", guardrail: string): string {
  const en = `Progressive: <one sentence>\nConservative: <one sentence>\nWeighing it: <one sentence>`;
  const enCommon = `Common ground: <one or two sentences>`;
  const ko = `진보: <한 문장>\n보수: <한 문장>\n정리: <한 문장>`;
  const koCommon = `공통된 시각: <한두 문장>`;
  return `${agent.personality}

${storyBlock(story)}

A God-centered reading of this story has already been given. Now judge it by human standards, fairly.

First decide honestly: do people really disagree along political lines about THIS story — about its facts, who is responsible, or what should be done? Most crimes, accidents, disasters, deaths, discoveries and results are NOT contested: nearly everyone reads them the same way. When in doubt, it is not contested. Never invent a split to fill the format.

FORMAT A — the story is genuinely contested. One sentence each, 30 words at most. State each view the way its own holders would recognise as fair, grounded in this story's facts and in who gains and who loses from it (name them) — not in abstract ideology; then weigh them: where each has a point and what each tends to miss.
${en}

FORMAT B — the story is not contested. One line only: how most people across the spectrum see it, and the practical question it leaves (two sentences at most).
${enCommon}

Use only the facts in the news text above; add no statistics or events. No hashtags, no markdown. Write only the labelled lines — no introduction before the first label and nothing after the last.

${langs === "ko"
    ? `한국어로만, 머리말이나 설명 없이 형식의 줄만 작성하세요. 형식 A는 "${ko.replace(/\n/g, " / ")}", 형식 B는 "${koCommon}" 입니다. 둘 중 하나만 쓰세요.`
    : `Write the chosen format in English, then the same content in natural Korean, exactly like this:\n[EN]\n<format A or B in English>\n[KO]\n<같은 형식의 한국어: 형식 A는 "${ko.replace(/\n/g, " / ")}", 형식 B는 "${koCommon}">\nEach label starts its own line.`}${guardrail}`;
}

/** Splits "[EN] … [KO] …" output. Without markers the whole text is treated as English. */
export function splitBilingual(input: string): { en: string; ko: string } {
  const raw = plain(input);
  const enAt = raw.search(/\[\s*EN\s*\]/i);
  const koAt = raw.search(/\[\s*KO\s*\]/i);
  if (koAt === -1) return { en: raw.replace(/\[\s*EN\s*\]/i, "").trim(), ko: "" };
  const strip = (s: string) => s.replace(/\[\s*(EN|KO)\s*\]/gi, "").trim();
  if (enAt !== -1 && enAt < koAt) return { en: strip(raw.slice(enAt, koAt)), ko: strip(raw.slice(koAt)) };
  if (enAt > koAt) return { en: strip(raw.slice(enAt)), ko: strip(raw.slice(koAt, enAt)) }; // Korean written first
  return { en: strip(raw.slice(0, koAt)), ko: strip(raw.slice(koAt)) };
}

const HUMAN_VIEW_LABEL = /^\s*(Progressive|Conservative|Weighing it|Common ground|진보|보수|정리|공통된 시각)\s*[:：]/m;

/** The human view is labelled lines only; a lead-in the model wrote before the first label is dropped. */
export function toHumanView(agent: string, raw: string, langs: "both" | "ko"): Perspective | null {
  const view = toPerspective(agent, raw, langs);
  if (!view) return null;
  const fromFirstLabel = (text: string) => {
    const at = text.search(HUMAN_VIEW_LABEL);
    return at > 0 ? text.slice(at).trim() : text;
  };
  return { agent, en: fromFirstLabel(view.en), ko: fromFirstLabel(view.ko) };
}

function briefLines(lang: NewsLang, b: Brief): string[] {
  return (["who", "what", "when", "where", "why", "how"] as const)
    .filter((f) => b[f])
    .map((f) => `${DISPLAY[lang][f]}: ${b[f]}`);
}

const isNoParty = (v: string | undefined) => {
  const t = (v ?? "").trim().toLowerCase().replace(/[."']/g, "");
  return isNotStated(v) || t.startsWith(NO_CLEAR_PARTY.en.toLowerCase()) || t.startsWith(NO_CLEAR_PARTY.ko);
};

/**
 * The objective balance sheet: who this news helps and who it costs. Shown as its own block so
 * the two sides can be compared at a glance. Nothing is forced: a side with no clear party says
 * so, and when neither side has one the block says that in a single line.
 */
function balanceBlock(lang: NewsLang, b: Brief | null): string {
  if (!b || (!b.helps && !b.hurts)) return ""; // the model wrote neither line: nothing to show
  if (isNoParty(b.helps) && isNoParty(b.hurts)) {
    return `${BALANCE_TITLE[lang]}\n${lang === "ko" ? "이 소식으로 뚜렷하게 득을 보거나 부담을 지는 쪽은 확인되지 않음" : "No party clearly gains or loses from this news"}`;
  }
  return [
    BALANCE_TITLE[lang],
    `${DISPLAY[lang].helps}: ${b.helps?.trim() || NO_CLEAR_PARTY[lang]}`,
    `${DISPLAY[lang].hurts}: ${b.hurts?.trim() || NO_CLEAR_PARTY[lang]}`,
  ].join("\n");
}

export type Perspective = { agent: string; en: string; ko: string };

/** Turns a perspective reply into its language parts; null when the model returned nothing (error, refusal). */
export function toPerspective(agent: string, raw: string, langs: "both" | "ko"): Perspective | null {
  if (!raw.trim()) return null;
  const parts = splitBilingual(raw);
  if (langs === "both") return { agent, ...parts };
  // Korean-only story: if the model added an English part anyway, keep just the Korean.
  return { agent, en: "", ko: parts.ko || parts.en };
}

/**
 * Builds the post text. Line 1 is always the headline (the dedup check reads it) and the
 * TL;DR lines come right after it, then the facts, then the balance sheet (who it helps, who it
 * costs), then the two readings. Sections with no content are left out. The human view is only
 * shown after a God-centered view in the same language — never on its own.
 */
export function assembleNewsPost(p: {
  story: NewsStory;
  /** Extra first-line tag, e.g. "🇰🇷 한국 뉴스". */
  badge?: string;
  en: Brief | null;
  ko: Brief | null;
  godView: Perspective | null;
  humanView: Perspective | null;
  footer?: string;
}): string {
  const { story, en, ko, godView, humanView } = p;
  const cite = (o: { sourceName: string; link: string | null }) => (o.link ? `${o.sourceName} — ${o.link}` : o.sourceName);
  const source = cite(story);
  const also = (story.others ?? []).slice(0, MAX_OTHER_REPORTS).map(cite).join(" · ");
  const block = (...lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join("\n");

  const head = block(
    `📰 ${story.title}${p.badge ? ` · ${p.badge}` : ""}`,
    en?.tldr && `${DISPLAY.en.tldr}: ${en.tldr}`,
    ko?.tldr && `${DISPLAY.ko.tldr}: ${ko.tldr}`,
  );

  const enSection = en && block(...briefLines("en", en), `Source: ${source}`, also && `Also reported by: ${also}`);
  const enViews = [
    godView?.en && `✝️ God-centered view — ${godView.agent}\n${godView.en}`,
    godView?.en && humanView?.en && `⚖️ Human view — ${humanView.agent}\n${humanView.en}`,
  ].filter(Boolean).join("\n\n");

  const koBody = ko && block(...briefLines("ko", ko), `출처: ${source}`, also && `함께 보도한 매체: ${also}`);
  const koViews = [
    godView?.ko && `✝️ 하나님 중심의 관점 — ${godView.agent}\n${godView.ko}`,
    godView?.ko && humanView?.ko && `⚖️ 사람의 관점 — ${humanView.agent}\n${humanView.ko}`,
  ].filter(Boolean).join("\n\n");
  // When there is an English section, the Korean one is set off under its own heading.
  const koSection = [koBody, balanceBlock("ko", ko), koViews].filter(Boolean).join("\n\n");
  const koBlock = koSection ? (enSection || enViews ? `---\n🇰🇷 한국어\n\n${koSection}` : koSection) : "";

  return [head, enSection, balanceBlock("en", en), enViews, koBlock, p.footer].filter(Boolean).join("\n\n");
}
