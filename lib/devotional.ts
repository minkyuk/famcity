import { parseReferences } from "@/lib/scripture";
import { HELPER_LABELS, HELPER_NAMES, type HelperRole } from "@/lib/devotionalPurpose";

export { DEVOTIONAL_PURPOSE_PRESET, HELPER_NAMES, isDevotionalPurpose, type HelperRole } from "@/lib/devotionalPurpose";

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
 *   - A helper speaks only when someone is speaking to it. Naming a helper, asking for prayer, or
 *     putting a question to a helper is certain. A post, a question nobody in particular was
 *     asked, or a longer reply to a helper is only a candidate: a short model check decides
 *     whether it is meant for the helpers or is the group talking among themselves (plans,
 *     greetings, thanks, each other).
 *   - The helpers are AI helpers, not members and not a spiritual authority: they don't claim
 *     to have prayed, they give the group words to pray; they don't settle questions on which
 *     churches differ, they show the passage and point to the pastor or 목자.
 */

export type Helper = { role: HelperRole; slug: string; ko: string; en: string; task: string };

const TASKS: Record<HelperRole, string> = {
  word: `help people understand the passage in front of them — its setting, what it says, and what it asks of us. Observation first, then meaning, then one application. You may end with ONE question for reflection, only if it helps them stay with the text.`,
  prayer: `turn what was shared into prayer. Name one to three things to pray for, then write a short prayer the group can pray together, introduced with words like "We can pray together like this:" (in Korean: "함께 이렇게 기도할 수 있습니다:"). Let Scripture shape the prayer.`,
  sharing: `receive what was shared with warmth and thanks, and say what Scripture speaks to it. You may add one gentle invitation for others in the group to share — never a challenge.`,
};

export const HELPERS: Helper[] = (["word", "prayer", "sharing"] as const).map((role) => ({ role, ...HELPER_LABELS[role], task: TASKS[role] }));

const HANGUL = /[가-힣]/g;
/** Mostly Korean? Decides the helper's name and the reply language. */
export function isKorean(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  return letters > 0 && (text.match(HANGUL)?.length ?? 0) / letters >= 0.3;
}

/** Links carry "?" and other noise; they are removed before a message is judged. */
const withoutLinks = (text: string) => text.replace(/https?:\/\/\S+/g, " ");
/** Trailing emoji, ㅠㅠ / ㅎㅎ and punctuation that come after the real end of a sentence. */
const TAIL = /[\s.!~…ㅠㅜㅎㅋ^\p{Extended_Pictographic}️]+$/u;

// A request for prayer — not a promise of it. "기도할게요" / "I'll pray for you" is what members say
// to each other, and a helper has no business answering it.
const ASKS_FOR_PRAYER = /기도\s*(부탁|요청)|기도해\s*주(세요|시|실|셔)|기도\s*제목|기도가?\s*필요|중보\s*(부탁|해\s*주)|please pray|pray for (me|us|my|our)\b|prayer requests?|needs? (your |some )?prayers?|keep (me|us|my|our)\b.{0,40}in (your )?prayers?/i;
const HARD_TIME = /아프|아파|병원|수술|힘들|힘든|어렵|걱정|불안|두렵|슬프|슬픔|지쳤|지치|외롭|우울|낙심|돌아가셨|장례|sick|hospital|surgery|struggl|anxious|afraid|grief|griev|tired|lonely|depress|passed away|funeral/i;
const ABOUT_THE_TEXT = /무슨\s*뜻|의미|해석|설명|본문|구절|말씀|성경|what does|meaning of|passage|verse|scripture|interpret|explain/i;
const ENDS_AS_QUESTION = /[?？]$|(까요|나요|가요|는지요|건가요|인가요|한가요|습니까|입니까|ㅂ니까|을까|일까|할까|뜻이야|뭐야|뭔가요)$/;
const ASKS_TO_BE_TOLD = /궁금|알려\s*주|설명해\s*주|설명\s*부탁|가르쳐\s*주|무슨\s*뜻|tell me|could you explain|can you explain|i wonder/i;
/** "아멘", "감사합니다 🙏", "아 그렇군요, 감사해요", "thanks!" — an acknowledgement, not something to answer. */
const INTERJECTION = /^((아|오|와|네|넵|예|아하|oh|ah|yes|ok(ay)?)[\s,.!~]+)+/i;
const ACKNOWLEDGEMENT = /^(아멘|감사|고맙|고마워|넵?|네+|예|맞아요?|그렇군요|이해했|알겠|좋아요|amen|thanks?|thank you|ok(ay)?|yes|got it|i see|wow|와+)[^\n]{0,24}$/i;
const ENDS_WITH_THANKS = /(감사합니다|감사해요|감사드려요|감사드립니다|고맙습니다|고마워요|thank you|thanks)$/i;

const looksLikeQuestion = (text: string) => {
  const clean = withoutLinks(text).trim();
  // Any sentence may be the question: check the end of each line and each sentence.
  return clean.split(/\n|(?<=[.!?？。])\s+/).some((part) => ENDS_AS_QUESTION.test(part.replace(TAIL, ""))) || ASKS_TO_BE_TOLD.test(clean);
};
const isAcknowledgement = (text: string) => {
  if (looksLikeQuestion(text)) return false;
  const clean = withoutLinks(text).replace(TAIL, "").trim().replace(INTERJECTION, "");
  return clean.length <= 8 || ACKNOWLEDGEMENT.test(clean) || (clean.length <= 40 && ENDS_WITH_THANKS.test(clean));
};
/** A helper is named: one of the six names, with or without the space ("기도도우미"). */
const namesAHelper = (text: string) => {
  const squeezed = text.toLowerCase().replace(/\s+/g, "");
  return HELPER_NAMES.some((name) => squeezed.includes(name.toLowerCase().replace(/\s+/g, "")));
};

/**
 * Which helper answers: an explicit prayer request goes to prayer; a question about the text (or
 * a message citing a passage) goes to the Word guide; a hard time goes to prayer; anything else
 * is sharing.
 */
export function chooseHelper(text: string): Helper {
  const pick = (role: HelperRole) => HELPERS.find((h) => h.role === role) ?? HELPERS[0];
  if (ASKS_FOR_PRAYER.test(text)) return pick("prayer");
  if (parseReferences(text).length > 0 || (ABOUT_THE_TEXT.test(text) && looksLikeQuestion(text))) return pick("word");
  if (HARD_TIME.test(text)) return pick("prayer");
  return pick("sharing");
}

type ThreadComment = { id: string; parentId: string | null; authorName: string; body: string; userId: string | null; createdAt: Date };
export type DevotionalThread = {
  userId: string | null;
  authorName: string;
  content: string | null;
  createdAt: Date;
  /** The newest comments, oldest first. */
  comments: ThreadComment[];
  /** True when older comments exist that are not in `comments` (a long thread). */
  truncated?: boolean;
};

/** Messages older than this are left alone — turning the mode on must not answer a backlog. */
export const DEVOTIONAL_ANSWER_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * A message a helper may answer. `commentId` is null when it is the post itself. `sure` is false
 * when the message is only a candidate and a model check has to decide whether it is meant for
 * the helpers.
 */
export type HelperAsk = { to: string; text: string; commentId: string | null; sure: boolean };

/** A comment by a helper (and only a helper: other account-less comments are not answers). */
export const isHelperComment = (c: { userId: string | null; authorName: string }) => c.userId == null && HELPER_NAMES.includes(c.authorName);
const isPerson = (c: { userId: string | null }) => c.userId != null;

/**
 * How a person's comment stands towards the helpers: true = certainly for them, false = a
 * candidate, null = not for them.
 */
function weigh(text: string, parent: ThreadComment | undefined): boolean | null {
  if (!text) return null;
  if (namesAHelper(text) || ASKS_FOR_PRAYER.test(text)) return true;
  const question = looksLikeQuestion(text);
  // Under a helper's comment: a question is for the helper, "아멘" is not, anything else is a candidate.
  if (parent && isHelperComment(parent)) return isAcknowledgement(text) ? null : question;
  // Under another member's comment: it is said to that member.
  if (parent && isPerson(parent)) return null;
  return question ? false : null;
}

/**
 * The messages in this thread a helper may answer, in the order they should be tried. A helper's
 * reply carries the id of the comment it answers (none when it answers the post), which is how a
 * message is known to be answered.
 *   1. Every person's comment that is certainly for the helpers and has no helper reply — oldest
 *      first. Later comments by other members ("저도 기도할게요") don't cancel a request.
 *   2. The post, when a person wrote it and no helper has replied to it — a candidate.
 *   3. The newest person's comment, when it is a candidate.
 */
export function helperAsks(post: DevotionalThread, now: number): HelperAsk[] {
  const fresh = (at: Date) => now - at.getTime() <= DEVOTIONAL_ANSWER_WINDOW_MS;
  const byId = new Map(post.comments.map((c) => [c.id, c]));
  /** What the helpers have answered: comment ids, and null for the post itself. */
  const answered = new Set(post.comments.filter(isHelperComment).map((c) => c.parentId));

  const certain: HelperAsk[] = [];
  let candidate: HelperAsk | null = null;
  for (const c of post.comments) {
    if (!isPerson(c)) continue;
    candidate = null; // only the newest person's comment can be a candidate
    const text = c.body.trim();
    if (!fresh(c.createdAt) || answered.has(c.id)) continue;
    const weight = weigh(text, c.parentId ? byId.get(c.parentId) : undefined);
    if (weight === null) continue;
    const ask = { to: c.authorName, text, commentId: c.id, sure: weight };
    if (weight) certain.push(ask);
    else candidate = ask;
  }

  // The post itself — unless the thread is too long to know whether a helper already answered it.
  const postText = (post.content ?? "").trim();
  const postAsk: HelperAsk[] =
    isPerson(post) && postText && fresh(post.createdAt) && !post.truncated && !answered.has(null)
      ? [{ to: post.authorName, text: postText, commentId: null, sure: false }]
      : [];

  return [...certain, ...postAsk, ...(candidate ? [candidate] : [])];
}

/** The yes/no question put to the model for a candidate (see HelperAsk.sure). */
export function helperWantedPrompt(o: { purpose: string; thread: string; ask: HelperAsk }): string {
  const what = o.ask.commentId ? "comment" : "post";
  return `A church small group talks in its own space ("${o.purpose}"). AI helpers are there to help people pray, read Scripture and know God. A helper answers when someone shares something about their life or faith, asks about Scripture, faith or prayer, or asks for help — and stays silent when the members are simply talking to each other: plans and logistics, greetings, thanks, small talk, questions put to one another.

${o.thread}

The newest ${what}, by ${o.ask.to}: "${o.ask.text.slice(0, 600)}"

Should a helper answer this ${what}? Reply with only YES or NO.`;
}

/**
 * The helper's prompt. `foundation` is the space-agent biblical foundation (it carries the fear
 * of the Lord, the glory of God and the Scripture rule); `thread` is the post and recent comments
 * already formatted.
 */
export function devotionalPrompt(o: { helper: Helper; korean: boolean; foundation: string; purpose: string; thread: string; ask: HelperAsk }): string {
  const name = o.korean ? o.helper.ko : o.helper.en;
  const to = o.ask.to;
  return `You are ${name} — a helper in a church small group's space. ${o.foundation}

This space: "${o.purpose}". The people here want to pray more, to read Scripture and to know God better. You are an AI helper — not a member of the group, not their pastor, not a spiritual authority. Never claim an experience you have not had: do not say "I prayed for you", "I will be praying" or "God told me". Your work is to help THEM pray, read and know Him.

Your part: ${o.helper.task}

${o.thread}

The message you are answering — ${to}'s ${o.ask.commentId ? "comment" : "post"}: "${o.ask.text.slice(0, 900)}"
Answer ${to}. What others wrote in the thread is context only.

How:
- Start from what ${to} actually wrote. One helpful thing, said simply — not three.
- Bring the Scripture that truly bears on it, with its reference.
- Do not debate, do not challenge, and do not try to keep the conversation going. Brief is good.
- Where faithful churches read Scripture differently (baptism, spiritual gifts, the end times, predestination and the like): show what the passage says, say plainly that Christians differ, and point ${to} to their pastor or 목자 rather than settling it yourself.
- If ${to} seems to be in danger or crisis (self-harm, abuse, despair that alarms you): answer with care in two sentences, urge them to reach their 목자 or pastor and someone near them today — and emergency services if they are in danger. Do not attempt counselling.
- 2–5 sentences; a prayer may run a few lines more. Plain prose: no markdown, no hashtags, and do not describe yourself.
- Write in ${o.korean ? "Korean (한국어)" : "English"}.`;
}
