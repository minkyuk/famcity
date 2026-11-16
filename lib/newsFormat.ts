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
};

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
  const unescaped = decodeEntities(raw.replace(/<!\[CDATA\[|\]\]>/g, ""));
  return decodeEntities(unescaped.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Only http(s) links are shown; a feed's <guid> fallback is often not a URL. */
export function cleanFeedLink(raw: string): string | null {
  const link = cleanFeedText(raw);
  return /^https?:\/\/\S+$/i.test(link) ? link : null;
}

export const KOREAN_NEWS_BADGE = "🇰🇷 한국 뉴스";

// Built with the constructor: \p{…} in a literal needs a newer compile target than this project's.
const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "u");
const HANGUL = /[\uAC00-\uD7A3]/;

/** Words that identify a story. Korean words are short, so two syllables count; Latin words need five letters. */
export function storyKeywords(title: string): Set<string> {
  return new Set(
    title.toLowerCase().split(NON_WORD).filter((w) => (HANGUL.test(w) ? w.length >= 2 : w.length > 4)),
  );
}

export function isSameStory(a: string, b: string): boolean {
  const ka = storyKeywords(a);
  const kb = storyKeywords(b);
  if (ka.size === 0 || kb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let overlap = 0;
  for (const w of ka) if (kb.has(w)) overlap++;
  return overlap >= 3 || (ka.size <= 4 && overlap >= 2);
}

/** The headline a stored news post was written about (its first line, without the 📰 mark and badge). */
export function headlineOfPost(content: string): string {
  const first = (content.split("\n")[0] ?? "").replace(/^📰\s*/u, "").trim();
  if (first === KOREAN_NEWS_BADGE) return ""; // old format: the badge alone was line 1
  return first.endsWith(` · ${KOREAN_NEWS_BADGE}`) ? first.slice(0, -` · ${KOREAN_NEWS_BADGE}`.length).trim() : first;
}

/** A story is posted only when at least this many voters chose it. */
export const MIN_VOTES_TO_POST = 2;

const BRIEF_FIELDS = ["tldr", "who", "what", "when", "where", "why", "how", "impact"] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
export type Brief = Partial<Record<BriefField, string>>;

/** Label the model writes (first alias) and the variants we accept back. */
const ALIASES: Record<NewsLang, Record<BriefField, string[]>> = {
  en: {
    tldr: ["TLDR", "TL;DR", "TL; DR", "SUMMARY"],
    who: ["WHO"], what: ["WHAT"], when: ["WHEN"], where: ["WHERE"], why: ["WHY"], how: ["HOW"],
    impact: ["IMPACT"],
  },
  ko: {
    tldr: ["요약", "TL;DR", "TLDR"],
    who: ["누가"], what: ["무엇을", "무엇"], when: ["언제"], where: ["어디서", "어디에서"], why: ["왜"], how: ["어떻게"],
    impact: ["영향"],
  },
};

/** Label shown in the post. */
const DISPLAY: Record<NewsLang, Record<BriefField, string>> = {
  en: { tldr: "TL;DR", who: "Who", what: "What", when: "When", where: "Where", why: "Why", how: "How", impact: "Impact" },
  ko: { tldr: "요약", who: "누가", what: "무엇을", when: "언제", where: "어디서", why: "왜", how: "어떻게", impact: "영향" },
};

export const NOT_STATED: Record<NewsLang, string> = { en: "Not stated in the source", ko: "출처에 없음" };

export function formatPublished(d: Date | null): string | null {
  if (!d || d.getTime() <= 0) return null;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Prompt for the factual brief. No persona: this part reports, it doesn't opine. */
export function briefPrompt(lang: NewsLang, story: NewsStory): string {
  const published = formatPublished(story.publishedAt);
  const text = story.articleText
    ? `${story.description.slice(0, 500)}\n${story.articleText}`
    : story.description.slice(0, 700);
  if (lang === "ko") {
    return `가족을 위한 사실 중심 뉴스 브리핑을 한국어로 작성하세요. 아래 출처 본문에 적힌 사실만 사용하세요. 본문에 없는 이름, 숫자, 날짜, 장소, 원인, 동기를 절대 추가하지 마세요. 본문에 없는 항목은 정확히 "${NOT_STATED.ko}"이라고 쓰세요. 본문에 제목과 관계없는 줄(광고, 다른 기사 안내)이 섞여 있으면 무시하세요.

출처: ${story.sourceName}${published ? `\n게시 시각: ${published}` : ""}
제목: ${story.title}
본문: ${text}

아래 여덟 줄을 이 순서대로, 한 줄에 하나씩, 일반 텍스트로만 쓰세요 (마크다운·별표 금지):
요약: 가장 중요한 사실을 한두 문장으로 (핵심 수치가 있으면 그것부터)
누가: 관련된 사람, 기관, 국가
무엇을: 무슨 일이 일어났는지
언제: 일어난 때. 본문에 날짜가 없으면 ${published ? `"${published} 보도"` : `"${NOT_STATED.ko}"`}라고 쓰세요
어디서: 일어난 곳
왜: 본문에 나온 원인이나 이유
어떻게: 어떤 방식으로 일어났거나 진행되는지
영향: 누가 이득을 보고 누가 부담을 지는지, 본문이 뒷받침하는 범위에서만`;
  }
  return `Write a factual news brief for a family. Use ONLY facts stated in the source text below. Never add a name, number, date, place, cause or motive that is not in it. If the text does not state an element, write exactly "${NOT_STATED.en}". Ignore any lines in the text that are not about the headline story (ads, links to other stories).

SOURCE: ${story.sourceName}${published ? `\nPUBLISHED: ${published}` : ""}
HEADLINE: ${story.title}
TEXT: ${text}

Write exactly these eight lines in this order, one per line, plain text only (no markdown, no asterisks):
TLDR: the single most important fact in one or two sentences (lead with the key number if there is one)
WHO: the people, organisations or countries involved
WHAT: what happened
WHEN: when it happened; if the text gives no date, write ${published ? `"Reported ${published}"` : `"${NOT_STATED.en}"`}
WHERE: where it happened
WHY: the cause or reason given in the text
HOW: how it happened or how it will work
IMPACT: who benefits and who bears the cost, only as far as the text supports`;
}

/** Models sometimes bold the labels despite being told not to. */
const plain = (s: string) => s.replace(/\*\*|__|`/g, "");

/** Parses "LABEL: value" lines (value may wrap onto following lines). Unknown lines before the first label are ignored. */
export function parseBrief(lang: NewsLang, raw: string): Brief {
  const aliasToField = new Map<string, BriefField>();
  for (const f of BRIEF_FIELDS) for (const a of ALIASES[lang][f]) aliasToField.set(a.toLowerCase(), f);
  const labels = [...aliasToField.keys()].sort((a, b) => b.length - a.length).map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const lineRe = new RegExp(`^\\s*(?:[-•*]\\s*)?(${labels.join("|")})\\s*[:：]\\s*(.*)$`, "i");

  const out: Brief = {};
  let current: BriefField | null = null;
  for (const line of plain(raw).split("\n")) {
    const m = line.match(lineRe);
    if (m) {
      current = aliasToField.get(m[1].toLowerCase()) ?? null;
      if (current && out[current] === undefined) out[current] = m[2].trim();
      else current = null; // repeated label: keep the first value
    } else if (current && line.trim()) {
      out[current] = `${out[current]} ${line.trim()}`.trim();
    }
  }
  for (const f of BRIEF_FIELDS) if (out[f] !== undefined && out[f] === "") delete out[f];
  return out;
}

/** A brief is usable when it has the TL;DR and at least four of the 5W1H facts. */
export function briefIsUsable(b: Brief): boolean {
  const facts = (["who", "what", "when", "where", "why", "how"] as const).filter((f) => b[f]).length;
  return !!b.tldr && facts >= 4;
}

type Persona = { name: string; personality: string };

const storyBlock = (s: NewsStory) =>
  `News (${s.sourceName}): ${s.title}\n${s.description.slice(0, 500)}${s.articleText ? `\n${s.articleText.slice(0, 700)}` : ""}`;

const BILINGUAL = `Write it twice — first in English, then the same content in natural Korean — in exactly this format:\n[EN]\n<English>\n[KO]\n<한국어>`;

/** The God-centered reading: always written first, never party-political. */
export function godViewPrompt(agent: Persona, story: NewsStory, langs: "both" | "ko", guardrail: string): string {
  return `${agent.personality}

${storyBlock(story)}

Write the God-centered reading of this story for a Christian family. This comes first, before any human opinion. Start from who God is and what Scripture actually teaches — His justice and mercy, His truth, His care for the poor and the stranger, the worth of every person made in His image, His rule over nations and history — and say what that means for how to see this event and how to pray about it. Do not force a connection: if a passage genuinely speaks to it, name the book and chapter, and do not quote verse wording unless you are certain of it; if none clearly applies, speak plainly from God's character. No party politics. Use only the facts in the news text above; add no new facts. 2–3 sentences. No hashtags, no markdown, do not start with "I".

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

If people really do disagree about THIS story along political lines: state how thoughtful progressives read it and how thoughtful conservatives read it — each put the way its own holders would recognise as fair, and grounded in this story's facts — then weigh them in one sentence: where each has a point and what each tends to miss.

If it is not politically contested (a disaster, a discovery, a result both sides read the same way), do not invent a split. Write the common-ground line instead: how most people across the spectrum see it, and the practical question it leaves.

Use only the facts in the news text above; add no statistics or events. No hashtags, no markdown.

${langs === "ko"
    ? `한국어로만, 정확히 다음 형식 중 하나로 작성하세요.\n의견이 실제로 갈릴 때:\n${ko}\n갈리지 않을 때:\n${koCommon}`
    : `Write it in English and then the same content in natural Korean, in exactly this format:\n[EN]\n${en}\n[KO]\n${ko}\n(when not contested, the [EN] part is the single line "${enCommon}" and the [KO] part is "${koCommon}")`}${guardrail}`;
}

/** Splits "[EN] … [KO] …" output. Without markers the whole text is treated as English. */
export function splitBilingual(input: string): { en: string; ko: string } {
  const raw = plain(input);
  const enAt = raw.search(/\[\s*EN\s*\]/i);
  const koAt = raw.search(/\[\s*KO\s*\]/i);
  if (koAt === -1) return { en: raw.replace(/\[\s*EN\s*\]/i, "").trim(), ko: "" };
  const strip = (s: string) => s.replace(/\[\s*(EN|KO)\s*\]/gi, "").trim();
  if (enAt !== -1 && enAt < koAt) return { en: strip(raw.slice(enAt, koAt)), ko: strip(raw.slice(koAt)) };
  return { en: strip(raw.slice(0, koAt)), ko: strip(raw.slice(koAt)) };
}

function briefLines(lang: NewsLang, b: Brief): string[] {
  return (["who", "what", "when", "where", "why", "how", "impact"] as const)
    .filter((f) => b[f])
    .map((f) => `${DISPLAY[lang][f]}: ${b[f]}`);
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
 * TL;DR lines come right after it. Sections with no content are left out. The human view is only
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
  const source = story.link ? `${story.sourceName} — ${story.link}` : story.sourceName;
  const block = (...lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join("\n");

  const head = block(
    `📰 ${story.title}${p.badge ? ` · ${p.badge}` : ""}`,
    en?.tldr && `${DISPLAY.en.tldr}: ${en.tldr}`,
    ko?.tldr && `${DISPLAY.ko.tldr}: ${ko.tldr}`,
  );

  const enSection = en && block(...briefLines("en", en), `Source: ${source}`);
  const enViews = [
    godView?.en && `✝️ God-centered view — ${godView.agent}\n${godView.en}`,
    godView?.en && humanView?.en && `⚖️ Human view — ${humanView.agent}\n${humanView.en}`,
  ].filter(Boolean).join("\n\n");

  const koBody = ko && block(...briefLines("ko", ko), `출처: ${source}`);
  const koViews = [
    godView?.ko && `✝️ 하나님 중심의 관점 — ${godView.agent}\n${godView.ko}`,
    godView?.ko && humanView?.ko && `⚖️ 사람의 관점 — ${humanView.agent}\n${humanView.ko}`,
  ].filter(Boolean).join("\n\n");
  // When there is an English section, the Korean one is set off under its own heading.
  const koSection = [koBody, koViews].filter(Boolean).join("\n\n");
  const koBlock = koSection ? (enSection || enViews ? `---\n🇰🇷 한국어\n\n${koSection}` : koSection) : "";

  return [head, enSection, enViews, koBlock, p.footer].filter(Boolean).join("\n\n");
}
