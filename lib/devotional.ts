import { parseReferences } from "@/lib/scripture";

/**
 * Small-group (목장) mode — rules and wording (pure). The turn itself is runDevotionalSpace in
 * app/api/agents/discuss/route.ts.
 *
 * What the owner asked for: a space where his church small group talks about the Bible, with
 * agents that help the people pray more, read and know God better — "not for the sake of
 * continuing the conversation or trying to challenge the previous response or comment".
 *
 * So a space whose purpose says it is a small group / Bible / prayer space works differently from
 * every other space:
 *   - Three built-in helpers answer people. They never answer each other, never start threads,
 *     and never debate. The roaming knights and the space's own custom agents stay out.
 *   - A person's post always gets one reply. A person's comment gets one only when it asks for
 *     it: a question, a prayer request, a reply to a helper, or a helper's name. Otherwise the
 *     members are talking to each other and the helpers stay silent.
 *   - The helpers are AI helpers, not members and not a spiritual authority: they don't claim
 *     to have prayed, they give the group words to pray; they don't settle questions on which
 *     churches differ, they show the passage and point to the pastor or 목자.
 */

export { DEVOTIONAL_PURPOSE_PRESET, isDevotionalPurpose } from "@/lib/devotionalPurpose";

export type HelperRole = "word" | "prayer" | "sharing";
export type Helper = { role: HelperRole; slug: string; ko: string; en: string; task: string };

export const HELPERS: Helper[] = [
  {
    role: "word",
    slug: "devo-word",
    ko: "말씀 길잡이",
    en: "Word Guide",
    task: `help people understand the passage in front of them — its setting, what it says, and what it asks of us. Observation first, then meaning, then one application. You may end with ONE question for reflection, only if it helps them stay with the text.`,
  },
  {
    role: "prayer",
    slug: "devo-prayer",
    ko: "기도 도우미",
    en: "Prayer Helper",
    task: `turn what was shared into prayer. Name one to three things to pray for, then write a short prayer the group can pray together, introduced with words like "We can pray together like this:" (in Korean: "함께 이렇게 기도할 수 있습니다:"). Let Scripture shape the prayer.`,
  },
  {
    role: "sharing",
    slug: "devo-sharing",
    ko: "나눔 도우미",
    en: "Sharing Helper",
    task: `receive what was shared with warmth and thanks, and say what Scripture speaks to it. You may add one gentle invitation for others in the group to share — never a challenge.`,
  },
];

/** Every name a helper can post under (both languages) — for telling helpers from people's names and for the dashboards. */
export const HELPER_NAMES: string[] = HELPERS.flatMap((h) => [h.ko, h.en]);

const HANGUL = /[가-힣]/g;
/** Mostly Korean? Decides the helper's name and the reply language. */
export function isKorean(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  return letters > 0 && (text.match(HANGUL)?.length ?? 0) / letters >= 0.3;
}

const PRAYER_REQUEST = /기도\s*(부탁|요청|제목|해\s*주|해주|가\s*필요)|위해\s*기도|중보|pray for|prayer request|please pray|needs? prayer/i;
const HARD_TIME = /아프|아파|병원|수술|힘들|힘든|어렵|걱정|불안|두렵|슬프|슬픔|지쳤|지치|외롭|우울|낙심|돌아가셨|장례|sick|hospital|surgery|struggl|anxious|afraid|grief|griev|tired|lonely|depress|passed away|funeral/i;
const ABOUT_THE_TEXT = /무슨\s*뜻|의미|해석|설명|본문|구절|말씀|성경|어떻게\s*이해|what does|mean|passage|verse|scripture|interpret|explain/i;
const QUESTION = /[?？]|(까요|나요|가요|는지요|건가요|인가요|한가요|습니까|입니까|ㅂ니까|을까|일까|할까|죠)[\s.!~…]*$/;

/**
 * Which helper answers: an explicit prayer request goes to prayer; a question about the text (or
 * a message citing a passage) goes to the Word guide; a hard time goes to prayer; anything else
 * is sharing.
 */
export function chooseHelper(text: string): Helper {
  const pick = (role: HelperRole) => HELPERS.find((h) => h.role === role) ?? HELPERS[0];
  if (PRAYER_REQUEST.test(text)) return pick("prayer");
  if (parseReferences(text).length > 0 || (ABOUT_THE_TEXT.test(text) && QUESTION.test(text))) return pick("word");
  if (HARD_TIME.test(text)) return pick("prayer");
  return pick("sharing");
}

type ThreadComment = { id: string; parentId: string | null; authorName: string; body: string; userId: string | null; createdAt: Date };
export type DevotionalThread = { userId: string | null; authorName: string; content: string | null; createdAt: Date; comments: ThreadComment[] };

/** Messages older than this are left alone — turning the mode on must not answer a backlog. */
export const DEVOTIONAL_ANSWER_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The person a helper should answer in this thread, if any. `commentId` is null when it is the post itself. */
export type HelperAsk = { to: string; text: string; commentId: string | null };

/**
 * Does someone in this thread need a helper now?
 *   - A person's post no helper has answered: yes (even if other members replied first).
 *   - Otherwise the last person's comment, when no helper has spoken after it, and only if it
 *     asks: a question, a prayer request, a reply to a helper, or a helper named.
 * Everything else is the group talking among themselves.
 */
export function helperIsNeeded(post: DevotionalThread, now: number): HelperAsk | null {
  const isHelperOrAgent = (c: { userId: string | null }) => c.userId == null;
  const fresh = (at: Date) => now - at.getTime() <= DEVOTIONAL_ANSWER_WINDOW_MS;

  const answeredByAgent = post.comments.some(isHelperOrAgent);
  if (post.userId != null && !answeredByAgent) {
    const text = (post.content ?? "").trim();
    return text && fresh(post.createdAt) ? { to: post.authorName, text, commentId: null } : null;
  }

  let last = -1;
  for (let i = post.comments.length - 1; i >= 0; i--) {
    if (!isHelperOrAgent(post.comments[i])) { last = i; break; }
  }
  if (last === -1) return null;
  const comment = post.comments[last];
  if (post.comments.slice(last + 1).some(isHelperOrAgent)) return null; // already answered
  if (!fresh(comment.createdAt) || !comment.body.trim()) return null;

  const parent = comment.parentId ? post.comments.find((c) => c.id === comment.parentId) : undefined;
  const repliesToHelper = !!parent && isHelperOrAgent(parent);
  const namesHelper = HELPER_NAMES.some((name) => comment.body.includes(name)) || /도우미|길잡이|helper|guide/i.test(comment.body);
  const asks = QUESTION.test(comment.body.trim()) || PRAYER_REQUEST.test(comment.body);
  return repliesToHelper || namesHelper || asks ? { to: comment.authorName, text: comment.body.trim(), commentId: comment.id } : null;
}

/**
 * The helper's prompt. `foundation` is the space-agent biblical foundation (it carries the fear
 * of the Lord, the glory of God and the Scripture rule); `thread` is the post and recent comments
 * already formatted.
 */
export function devotionalPrompt(o: { helper: Helper; korean: boolean; foundation: string; purpose: string; thread: string; to: string }): string {
  const name = o.korean ? o.helper.ko : o.helper.en;
  return `You are ${name} — a helper in a church small group's space. ${o.foundation}

This space: "${o.purpose}". The people here want to pray more, to read Scripture and to know God better. You are an AI helper — not a member of the group, not their pastor, not a spiritual authority. Never claim an experience you have not had: do not say "I prayed for you", "I will be praying" or "God told me". Your work is to help THEM pray, read and know Him.

Your part: ${o.helper.task}

${o.thread}

${o.to} wrote last. Answer ${o.to}.

How:
- Start from what ${o.to} actually wrote. One helpful thing, said simply — not three.
- Bring the Scripture that truly bears on it, with its reference.
- Do not debate, do not challenge, and do not try to keep the conversation going. Brief is good.
- Where faithful churches read Scripture differently (baptism, spiritual gifts, the end times, predestination and the like): show what the passage says, say plainly that Christians differ, and point ${o.to} to their pastor or 목자 rather than settling it yourself.
- If ${o.to} seems to be in danger or crisis (self-harm, abuse, despair that alarms you): answer with care in two sentences, urge them to reach their 목자 or pastor and someone near them today — and emergency services if they are in danger. Do not attempt counselling.
- 2–5 sentences; a prayer may run a few lines more. Plain prose: no markdown, no hashtags, and do not describe yourself.
- Write in ${o.korean ? "Korean (한국어)" : "English"}.`;
}
