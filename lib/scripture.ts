import { AGENT_MODEL, AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";
import { recordAiCall } from "@/lib/aiCallLog";
import { currentAgent } from "@/lib/agentContext";
import kjvIndex from "@/data/kjv/index.json";

/**
 * Scripture check: before an agent's text is posted, every Bible reference in it is checked
 * against a real Bible text.
 *
 *   1. The passage must exist — "Proverbs 35:2" is refused outright, no model involved.
 *   2. What the text says the verse says must be what the verse says. The verse is looked up in
 *      the King James Version (data/kjv, public domain) and a short model call compares meaning.
 *
 * Why the KJV when agents quote the NKJV (English) and 개역개정 (Korean): those texts are under
 * copyright and cannot be bundled, so wording can't be compared letter for letter. The KJV is
 * the NKJV's parent translation and free to use; it settles whether the verse exists and whether
 * the agent is putting words in its mouth, which are the errors that matter most. Small wording
 * slips against the NKJV are NOT caught.
 */

type BookEntry = { file: string; name: string; verses: number[] };
const INDEX: BookEntry[] = kjvIndex;

/** A verse number this far past the KJV's count is treated as a versification difference, not an invention. */
const VERSIFICATION_SLACK = 2;
/** References checked per text, and verses quoted to the checker per reference. */
const MAX_REFS = 4;
const MAX_RANGE = 6;

/**
 * Names per book, in canon order (same order as data/kjv/index.json).
 * `family` marks numbered books that share a name: "Samuel" needs its 1 or 2.
 */
type BookNames = { en: string[]; ko: string[]; koShort: string; family?: { base: string[]; n: number } };
const single = (en: string[], ko: string[], koShort: string): BookNames => ({ en, ko, koShort });
const numbered = (n: number, base: string[], ko: string[], koShort: string): BookNames => ({ en: [], ko, koShort, family: { base, n } });

const BOOKS: BookNames[] = [
  single(["Genesis", "Gen"], ["창세기"], "창"),
  single(["Exodus", "Exod", "Ex"], ["출애굽기"], "출"),
  single(["Leviticus", "Lev"], ["레위기"], "레"),
  single(["Numbers", "Num"], ["민수기"], "민"),
  single(["Deuteronomy", "Deut"], ["신명기"], "신"),
  single(["Joshua", "Josh"], ["여호수아"], "수"),
  single(["Judges", "Judg"], ["사사기"], "삿"),
  single(["Ruth"], ["룻기"], "룻"),
  numbered(1, ["Samuel", "Sam"], ["사무엘상"], "삼상"),
  numbered(2, ["Samuel", "Sam"], ["사무엘하"], "삼하"),
  numbered(1, ["Kings", "Kgs"], ["열왕기상"], "왕상"),
  numbered(2, ["Kings", "Kgs"], ["열왕기하"], "왕하"),
  numbered(1, ["Chronicles", "Chron", "Chr"], ["역대상"], "대상"),
  numbered(2, ["Chronicles", "Chron", "Chr"], ["역대하"], "대하"),
  single(["Ezra"], ["에스라"], "스"),
  single(["Nehemiah", "Neh"], ["느헤미야"], "느"),
  single(["Esther", "Esth"], ["에스더"], "에"),
  single(["Job"], ["욥기"], "욥"),
  single(["Psalms", "Psalm", "Psa", "Ps"], ["시편"], "시"),
  single(["Proverbs", "Prov"], ["잠언"], "잠"),
  single(["Ecclesiastes", "Eccl", "Ecc"], ["전도서"], "전"),
  single(["Song of Solomon", "Song of Songs", "Song"], ["아가"], "아"),
  single(["Isaiah", "Isa"], ["이사야"], "사"),
  single(["Jeremiah", "Jer"], ["예레미야"], "렘"),
  single(["Lamentations", "Lam"], ["예레미야애가", "애가"], "애"),
  single(["Ezekiel", "Ezek"], ["에스겔"], "겔"),
  single(["Daniel", "Dan"], ["다니엘"], "단"),
  single(["Hosea", "Hos"], ["호세아"], "호"),
  single(["Joel"], ["요엘"], "욜"),
  single(["Amos"], ["아모스"], "암"),
  single(["Obadiah", "Obad"], ["오바댜"], "옵"),
  single(["Jonah"], ["요나"], "욘"),
  single(["Micah", "Mic"], ["미가"], "미"),
  single(["Nahum", "Nah"], ["나훔"], "나"),
  single(["Habakkuk", "Hab"], ["하박국"], "합"),
  single(["Zephaniah", "Zeph"], ["스바냐"], "습"),
  single(["Haggai", "Hag"], ["학개"], "학"),
  single(["Zechariah", "Zech"], ["스가랴"], "슥"),
  single(["Malachi", "Mal"], ["말라기"], "말"),
  single(["Matthew", "Matt", "Mt"], ["마태복음", "마태"], "마"),
  single(["Mark", "Mk"], ["마가복음", "마가"], "막"),
  single(["Luke", "Lk"], ["누가복음", "누가"], "눅"),
  single(["John", "Jn"], ["요한복음"], "요"),
  single(["Acts"], ["사도행전"], "행"),
  single(["Romans", "Rom"], ["로마서"], "롬"),
  numbered(1, ["Corinthians", "Cor"], ["고린도전서"], "고전"),
  numbered(2, ["Corinthians", "Cor"], ["고린도후서"], "고후"),
  single(["Galatians", "Gal"], ["갈라디아서"], "갈"),
  single(["Ephesians", "Eph"], ["에베소서"], "엡"),
  single(["Philippians", "Phil"], ["빌립보서"], "빌"),
  single(["Colossians", "Col"], ["골로새서"], "골"),
  numbered(1, ["Thessalonians", "Thess"], ["데살로니가전서"], "살전"),
  numbered(2, ["Thessalonians", "Thess"], ["데살로니가후서"], "살후"),
  numbered(1, ["Timothy", "Tim"], ["디모데전서"], "딤전"),
  numbered(2, ["Timothy", "Tim"], ["디모데후서"], "딤후"),
  single(["Titus"], ["디도서"], "딛"),
  single(["Philemon", "Philem", "Phlm"], ["빌레몬서"], "몬"),
  single(["Hebrews", "Heb"], ["히브리서"], "히"),
  single(["James", "Jas"], ["야고보서"], "약"),
  numbered(1, ["Peter", "Pet"], ["베드로전서"], "벧전"),
  numbered(2, ["Peter", "Pet"], ["베드로후서"], "벧후"),
  numbered(1, ["John", "Jn"], ["요한일서", "요한1서"], "요일"),
  numbered(2, ["John", "Jn"], ["요한이서", "요한2서"], "요이"),
  numbered(3, ["John", "Jn"], ["요한삼서", "요한3서"], "요삼"),
  single(["Jude"], ["유다서"], "유"),
  single(["Revelation", "Revelations", "Rev"], ["요한계시록", "계시록"], "계"),
];

/**
 * A chapter given without a verse ("Ezekiel 18") is only recognised for these names — "Mark 5"
 * or "Job 3" in ordinary prose would otherwise be read as Scripture.
 */
const CHAPTER_ONLY_OK = new Set([
  "Genesis", "Exodus", "Leviticus", "Deuteronomy", "Psalms", "Psalm", "Proverbs", "Ecclesiastes", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Hosea", "Micah", "Habakkuk", "Zechariah", "Malachi", "Matthew", "Romans", "Corinthians",
  "Galatians", "Ephesians", "Philippians", "Colossians", "Thessalonians", "Hebrews", "Revelation",
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const longestFirst = (a: string, b: string) => b.length - a.length;

const EN_SINGLE = new Map<string, number>();
const EN_FAMILY = new Map<string, Map<number, number>>(); // base name → number → book
const KO_FULL = new Map<string, number>();
const KO_SHORT = new Map<string, number>();
BOOKS.forEach((b, i) => {
  for (const name of b.en) EN_SINGLE.set(name, i);
  for (const name of b.ko) KO_FULL.set(name, i);
  KO_SHORT.set(b.koShort, i);
  if (b.family) {
    for (const base of b.family.base) {
      const byNumber = EN_FAMILY.get(base) ?? new Map<number, number>();
      byNumber.set(b.family.n, i);
      EN_FAMILY.set(base, byNumber);
    }
  }
});

const EN_NAMES = [...new Set([...EN_SINGLE.keys(), ...EN_FAMILY.keys()])].sort(longestFirst).map(escapeRe).join("|");
const DASH = "[-–—~]";
// [1 ]Name[.] chapter[:verse[-verse]] — names are capitalised as written in English, so "mark 10:30" is not a reference.
const EN_RE = new RegExp(
  `(?<![A-Za-z0-9])(?:(1st|2nd|3rd|First|Second|Third|III|II|I|[123])\\s*)?(${EN_NAMES})\\.?\\s+(\\d{1,3})(?:\\s*:\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?)?(?![\\d:])`,
  "g",
);
const KO_NAMES = [...KO_FULL.keys()].sort(longestFirst).map(escapeRe).join("|");
// The name must start a word: "의미가 3:1" is not Micah.
// 잠언 9:10 · 잠언 9:10-12
const KO_COLON_RE = new RegExp(`(?<![가-힣])(${KO_NAMES})\\s*(\\d{1,3})\\s*:\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?`, "g");
// 잠언 9장 10절 · 잠언 9장 10-12절 · 시편 23편 1절 · 잠언 9장 (a bare number after 장 is not a verse: "9장 3가지")
const KO_JANG_RE = new RegExp(`(?<![가-힣])(${KO_NAMES})\\s*(\\d{1,3})\\s*(?:장|편)(?:\\s*(\\d{1,3})(?:\\s*절|\\s*${DASH}\\s*(\\d{1,3})\\s*절))?`, "g");
// (잠 9:10) — one-syllable abbreviations are everyday words too ("약 3:1"), so only inside parentheses.
const KO_SHORT_RE = new RegExp(
  `\\(\\s*(${[...KO_SHORT.keys()].sort(longestFirst).map(escapeRe).join("|")})\\s*(\\d{1,3})\\s*:\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?`,
  "g",
);

const ORDINAL: Record<string, number> = { "1": 1, "2": 2, "3": 3, I: 1, II: 2, III: 3, First: 1, Second: 2, Third: 3, "1st": 1, "2nd": 2, "3rd": 3 };

export type ScriptureRef = {
  /** Index into the canon (0 = Genesis … 65 = Revelation). */
  book: number;
  chapter: number;
  /** null when only a chapter was cited. */
  verse: number | null;
  endVerse: number | null;
  /** The reference as it appeared in the text. */
  raw: string;
};

const num = (s: string | undefined) => (s ? Number(s) : null);

/** Every Bible reference in `text`, English or Korean, in order of appearance, without repeats. */
export function parseReferences(text: string): ScriptureRef[] {
  const found: (ScriptureRef & { at: number })[] = [];
  const add = (at: number, raw: string, book: number, chapter: number, verse: number | null, endVerse: number | null) => {
    found.push({ at, raw: raw.trim(), book, chapter, verse, endVerse: endVerse !== null && verse !== null && endVerse > verse ? endVerse : null });
  };

  for (const m of text.matchAll(EN_RE)) {
    const [raw, ordinal, name, chapter, verse, endVerse] = m;
    if (verse === undefined && !CHAPTER_ONLY_OK.has(name)) continue;
    const family = EN_FAMILY.get(name);
    const n = ordinal ? ORDINAL[ordinal] : undefined;
    // "1 John" is the letter, "John" the Gospel; "Samuel 3:1" with no number is not a reference.
    const numberedBook = n !== undefined ? family?.get(n) : undefined;
    const plainBook = EN_SINGLE.get(name);
    const candidate = (book: number): ScriptureRef => ({ book, chapter: Number(chapter), verse: num(verse), endVerse: num(endVerse), raw });
    // A stray number in front ("chapter 3 John 3:16") must not turn the Gospel into a letter that
    // has no such chapter: when the numbered reading doesn't exist and the plain one does, take the plain one.
    const book =
      numberedBook !== undefined && (plainBook === undefined || refStatus(candidate(numberedBook)) !== "missing") ? numberedBook
      : n === undefined || numberedBook !== undefined ? plainBook
      : undefined;
    if (book === undefined) continue;
    add(m.index ?? 0, numberedBook === book ? raw : raw.replace(/^\S+\s+/, numberedBook !== undefined ? "" : "$&"), book, Number(chapter), num(verse), num(endVerse));
  }
  for (const re of [KO_COLON_RE, KO_JANG_RE]) {
    for (const m of text.matchAll(re)) {
      const [raw, name, chapter, verse, endVerse] = m;
      const book = KO_FULL.get(name);
      if (book !== undefined) add(m.index ?? 0, raw, book, Number(chapter), num(verse), num(endVerse));
    }
  }
  for (const m of text.matchAll(KO_SHORT_RE)) {
    const [raw, name, chapter, verse, endVerse] = m;
    const book = KO_SHORT.get(name);
    if (book !== undefined) add(m.index ?? 0, raw.replace(/^\(\s*/, ""), book, Number(chapter), num(verse), num(endVerse));
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((r) => {
      const key = `${r.book}:${r.chapter}:${r.verse}:${r.endVerse}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({ book: r.book, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, raw: r.raw }));
}

export const refLabel = (r: ScriptureRef) =>
  `${INDEX[r.book].name} ${r.chapter}${r.verse !== null ? `:${r.verse}${r.endVerse !== null ? `-${r.endVerse}` : ""}` : ""}`;

/**
 * "exists": the passage is there. "unverifiable": the chapter exists and the verse number is just
 * past the KJV's count (translations number a few chapters differently). "missing": no such passage.
 */
export function refStatus(r: ScriptureRef): "exists" | "unverifiable" | "missing" {
  const book = INDEX[r.book];
  if (!book || r.chapter < 1 || r.chapter > book.verses.length) return "missing";
  if (r.verse === null) return "exists";
  const count = book.verses[r.chapter - 1];
  if (r.verse < 1) return "missing";
  if (r.verse <= count) return "exists";
  return r.verse <= count + VERSIFICATION_SLACK ? "unverifiable" : "missing";
}

/** The verse (or short range) in the KJV; null when it can't be read. One book file is loaded on demand. */
export async function verseText(r: ScriptureRef): Promise<string | null> {
  if (r.verse === null || refStatus(r) !== "exists") return null;
  try {
    const mod = await import(`@/data/kjv/${INDEX[r.book].file}.json`);
    const chapters = mod.default as string[][]; // generated by us: an array of chapters, each an array of verse strings
    const chapter = chapters[r.chapter - 1];
    const last = Math.min(r.endVerse ?? r.verse, chapter.length, r.verse + MAX_RANGE - 1);
    return chapter.slice(r.verse - 1, last).join(" ").slice(0, 900);
  } catch {
    return null;
  }
}

export type ScriptureVerdict = { ok: true; checked: number } | { ok: false; reason: string };

/**
 * Checks every reference in `text`. A passage that doesn't exist fails without a model call.
 * Verses that exist are read from the KJV and one short call judges whether the text represents
 * them faithfully. An unreadable checker answer or an API error passes the text — the existence
 * check has still run.
 */
export async function checkScripture(text: string): Promise<ScriptureVerdict> {
  const refs = parseReferences(text).slice(0, MAX_REFS);
  if (refs.length === 0) return { ok: true, checked: 0 };

  const missing = refs.find((r) => refStatus(r) === "missing");
  if (missing) return { ok: false, reason: `no such passage: ${missing.raw}` };

  const withText = (await Promise.all(refs.map(async (r) => ({ ref: r, verse: await verseText(r) }))))
    .filter((x): x is { ref: ScriptureRef; verse: string } => x.verse !== null);
  if (withText.length === 0) return { ok: true, checked: 0 };

  try {
    const msg = await anthropicFor("scripture:check").messages.create({
      ...AGENT_REQUEST,
      max_tokens: 40,
      messages: [{
        role: "user",
        content: `A comment written for a Christian family cites Scripture. Check each citation against the Bible text below. The text is the King James Version; the comment may quote another translation (NKJV, 개역개정) in English or Korean, so the wording will differ — judge the meaning, not the wording.

Comment: "${text.slice(0, 1500)}"

Bible text:
${withText.map((x, i) => `[${i + 1}] ${refLabel(x.ref)} — "${x.verse}"`).join("\n")}

For each number: is what the comment says this passage says (quoted or paraphrased) really what it says?
Answer NO only if the comment puts words or a teaching into this passage that it does not contain, or has plainly cited the wrong passage for the words it quotes.
Answer OK if the comment quotes or paraphrases it faithfully, or only points the reader to it.
Reply with one line per number, nothing else: "1 OK" or "1 NO".`,
      }],
    });
    const verdicts = [...textOf(msg).matchAll(/(\d+)\s*[:.)-]?\s*(OK|NO)\b/gi)];
    const wrong = verdicts.find((v) => v[2].toUpperCase() === "NO");
    if (wrong) {
      const ref = withText[Number(wrong[1]) - 1]?.ref;
      return { ok: false, reason: `does not match ${ref ? refLabel(ref) : "the passage cited"}` };
    }
    return { ok: true, checked: withText.length };
  } catch {
    return { ok: true, checked: 0 };
  }
}

/**
 * Gate form of checkScripture, for the comment and post paths. A refusal is written to the AI call
 * log as `scripture:rejected` (with the agent and the reason), so the dashboard's failure list
 * shows how often drafts are dropped for Scripture and why.
 */
export async function scriptureIsFaithful(text: string): Promise<boolean> {
  return (await scriptureProblem(text)) === null;
}

/** The same gate, saying why: null when the text passes, otherwise the reason (logged like any refusal). */
export async function scriptureProblem(text: string): Promise<string | null> {
  const verdict = await checkScripture(text);
  if (verdict.ok) return null;
  void recordAiCall({
    route: "scripture:rejected", model: AGENT_MODEL, agent: currentAgent(), ok: false, status: 422,
    errorType: "invalid_request", errorMessage: `${verdict.reason} — draft: ${text.slice(0, 300)}`,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0,
  });
  return verdict.reason;
}
