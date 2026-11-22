import { parseReferences } from "@/lib/scripture";
import { HELPER_LABELS, HELPER_NAMES, type HelperRole } from "@/lib/devotionalPurpose";
import { claimIsOpen as sharedClaimIsOpen, claimRow, readClaim, type Claim, type ClaimOutcome, type ClaimPolicy } from "@/lib/replyClaims";

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
 *   - Every person's post and comment gets one helper reply (owner's decision, after a first
 *     version answered only when spoken to). The reply stays brief and ends with the Word or a
 *     prayer, never with a question — so answering everyone doesn't turn into keeping the
 *     conversation going. A bare "아멘" / "감사합니다" gets one short sentence.
 *   - The helpers are AI helpers, not members and not a spiritual authority: they don't claim
 *     to have prayed, they give the group words to pray; they don't settle questions on which
 *     churches differ, they show the passage and point to the pastor or 목자.
 */

export type Helper = { role: HelperRole; slug: string; ko: string; en: string; task: string };

const TASKS: Record<HelperRole, string> = {
  word: `help people understand the passage in front of them — its setting, what it says, and what it asks of us. Observation first, then meaning, then one application.`,
  prayer: `turn what was shared into prayer. Name one to three things to pray for, then write a short prayer the group can pray together, introduced with words like "We can pray together like this:" (in Korean: "함께 이렇게 기도할 수 있습니다:"). Let Scripture shape the prayer.`,
  sharing: `receive what was shared with warmth and thanks, and say what Scripture speaks to it.`,
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
const ASKS_FOR_PRAYER = /기도\s*(부탁|요청)|기도해\s*주(세요|시|실|셔)|기도가?\s*필요|중보\s*(부탁|해\s*주)|please pray|pray for (me|us|my|our)\b|needs? (your |some )?prayers?|keep (me|us|my|our)\b.{0,40}in (your )?prayers?/i;
/** "기도제목" / "prayer request": usually someone sharing theirs, sometimes only a plan to share them — a candidate. */
const MENTIONS_PRAYER_REQUEST = /기도\s*제목|prayer requests?/i;
const HARD_TIME = /아프|아파|병원|수술|힘들|힘든|어렵|걱정|불안|두렵|슬프|슬픔|지쳤|지치|외롭|우울|낙심|돌아가셨|장례|sick|hospital|surgery|struggl|anxious|afraid|grief|griev|tired|lonely|depress|passed away|funeral/i;
const ABOUT_THE_TEXT = /무슨\s*뜻|의미|해석|설명|본문|구절|말씀|성경|what does|meaning of|passage|verse|scripture|interpret|explain/i;
/** A question mark, or an outright request to be told. */
const ASKS_TO_BE_TOLD = /알려\s*주|설명해\s*주|설명\s*부탁|가르쳐\s*주|tell me|could you explain|can you explain/i;
/** Endings and words that often mark a question but also end plain statements ("생각나요", "궁금해서 찾아봤어요"). */
const MAY_END_AS_QUESTION = /(까요|나요|가요|는지요|건가요|인가요|한가요|습니까|입니까|ㅂ니까|을까|일까|할까|뜻이야|뭐야|뭔가요)$/;
const WONDERS = /궁금|무슨\s*뜻|i wonder/i;

/** The sentences of a message, links removed, trailing emoji and punctuation trimmed from each. */
const sentences = (text: string) => withoutLinks(text).split(/\n|(?<=[.!?？。])\s+/).map((part) => part.trim()).filter(Boolean);
/** Asked outright: a sentence ends in a question mark, or the message asks to be told something. */
const asksOutright = (text: string) => sentences(text).some((part) => /[?？]/.test(part.slice(-3))) || ASKS_TO_BE_TOLD.test(withoutLinks(text));
/** Asked outright, or worded in a way that may be a question — enough for a candidate, not for certainty. */
const looksLikeQuestion = (text: string) =>
  asksOutright(text) || sentences(text).some((part) => MAY_END_AS_QUESTION.test(part.replace(TAIL, ""))) || WONDERS.test(withoutLinks(text));

// "아멘", "감사합니다 🙏", "아 그렇군요, 이해했어요 감사합니다", "thanks!" — an acknowledgement, not
// something to answer: nothing but acknowledging words, or a short line that ends in thanks.
const INTERJECTION = /^((아|오|와|네|넵|예|아하|oh|ah|yes|ok(ay)?)[\s,.!~]+)+/i;
const ACK_WORDS =
  "아멘|감사합니다|감사해요|감사드려요|감사드립니다|감사|고맙습니다|고마워요|고맙|넵|네|예|맞아요|맞습니다|그렇군요|그렇네요|이해했어요|이해했습니다|이해됐어요|알겠습니다|알겠어요|좋아요|좋네요|amen|thanks|thank you|ok|okay|yes|got it|i see|wow|와";
const ACKNOWLEDGEMENT = new RegExp(`^(?:(?:${ACK_WORDS})[\\s,.!~]*)+$`, "i");
const ENDS_WITH_THANKS = /(감사합니다|감사해요|감사드려요|감사드립니다|고맙습니다|고마워요|thank you|thanks)$/i;
const isAcknowledgement = (text: string) => {
  if (looksLikeQuestion(text) || HARD_TIME.test(text)) return false;
  const clean = withoutLinks(text).replace(TAIL, "").trim().replace(INTERJECTION, "");
  return clean.length === 0 || ACKNOWLEDGEMENT.test(clean) || (clean.length <= 20 && ENDS_WITH_THANKS.test(clean));
};

/**
 * Which helper answers: an explicit prayer request goes to prayer; a question about the text (or
 * a message citing a passage) goes to the Word guide; a hard time goes to prayer; anything else
 * is sharing.
 */
export function chooseHelper(text: string): Helper {
  const pick = (role: HelperRole) => HELPERS.find((h) => h.role === role) ?? HELPERS[0];
  if (ASKS_FOR_PRAYER.test(text) || MENTIONS_PRAYER_REQUEST.test(text)) return pick("prayer");
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
/** When the helpers began answering every comment (comments before it were judged by the earlier rule). */
export const EVERY_COMMENT_FROM = new Date("2026-11-22T21:26:00Z");

/** A message a helper answers. `commentId` is null when it is the post itself. */
export type HelperAsk = { to: string; text: string; commentId: string | null };

/** A comment by a helper (and only a helper: other account-less comments are not answers). */
export const isHelperComment = (c: { userId: string | null; authorName: string }) => c.userId == null && HELPER_NAMES.includes(c.authorName);
const isPerson = (c: { userId: string | null }) => c.userId != null;

/** What the helpers have already answered in this thread: comment ids, and null for the post itself. */
const answeredIn = (post: DevotionalThread) => new Set(post.comments.filter(isHelperComment).map((c) => c.parentId));

/**
 * The messages in this thread a helper answers, oldest first: the post, then every person's
 * comment — a reply to a member included — that has no helper reply under it. A helper's reply
 * carries the id of the comment it answers (none when it answers the post), which is how a
 * message is known to be answered, so a later comment never cancels an earlier one. Agents'
 * messages are never answered: helpers don't answer helpers.
 */
export function helperAsks(post: DevotionalThread, now: number, opts: { commentsFrom?: Date } = {}): HelperAsk[] {
  const fresh = (at: Date) => now - at.getTime() <= DEVOTIONAL_ANSWER_WINDOW_MS;
  // Comments from before the helpers answered every comment were judged by the earlier rule;
  // turning the new rule on must not answer that backlog.
  const commentsFrom = opts.commentsFrom?.getTime() ?? 0;
  const answered = answeredIn(post);
  const asks: HelperAsk[] = [];

  // The post itself — unless the thread is too long to know whether a helper already answered it.
  const postText = (post.content ?? "").trim();
  if (isPerson(post) && postText && fresh(post.createdAt) && !post.truncated && !answered.has(null)) {
    asks.push({ to: post.authorName, text: postText, commentId: null });
  }
  for (const c of post.comments) {
    const text = c.body.trim();
    if (isPerson(c) && text && fresh(c.createdAt) && c.createdAt.getTime() >= commentsFrom && !answered.has(c.id)) {
      asks.push({ to: c.authorName, text, commentId: c.id });
    }
  }
  return asks;
}


/**
 * Just before a reply is posted: is the message still there and still unanswered? Looser than
 * helperAsks on purpose — a newer comment by another member doesn't make a prepared reply wrong.
 */
export function stillUnanswered(post: DevotionalThread, ask: HelperAsk): boolean {
  if (answeredIn(post).has(ask.commentId)) return false;
  return ask.commentId === null ? isPerson(post) : post.comments.some((c) => c.id === ask.commentId && isPerson(c));
}

// ── One claim per message ───────────────────────────────────────────────────────────────────
// The rules are shared with the replies to people's comments (lib/replyClaims.ts), and so is the
// policy: another run may take over after 5 minutes, a dropped draft is retried after 20 minutes,
// and three drafts that fail a gate end it.

export type DevotionalOutcome = ClaimOutcome;
export type DevotionalClaim = Claim;
export { readClaim };

export const CLAIM_WORKING_MS = 5 * 60 * 1000;
export const CLAIM_RETRY_MS = 20 * 60 * 1000;
export const CLAIM_MAX_TRIES = 3;
const DEVOTIONAL_CLAIM_POLICY: ClaimPolicy = { workingMs: CLAIM_WORKING_MS, retryMs: CLAIM_RETRY_MS, maxTries: CLAIM_MAX_TRIES };

/** May this message's turn be taken now? `claim` is its row as just read (undefined = no row yet). */
export const claimIsOpen = (claim: DevotionalClaim | undefined, now: number) => sharedClaimIsOpen(claim, now, DEVOTIONAL_CLAIM_POLICY);

/** What to store when a helper's turn ends. Only a draft that failed a gate counts as a try. */
export const settledClaim = (outcome: DevotionalOutcome, tries: number) => claimRow(outcome, outcome === "dropped" ? tries + 1 : tries);

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
- Do not debate, do not challenge, and do not try to keep the conversation going. Brief is good. End with the Word or the prayer itself — not with a question, and not with an invitation to reply.
- Where faithful churches read Scripture differently (baptism, spiritual gifts, the end times, predestination and the like): show what the passage says, say plainly that Christians differ, and point ${to} to their pastor or 목자 rather than settling it yourself.
- If ${to} seems to be in danger or crisis (self-harm, abuse, despair that alarms you): answer with care in two sentences, urge them to reach their 목자 or pastor and someone near them today — and emergency services if they are in danger. Do not attempt counselling.
- ${isAcknowledgement(o.ask.text) ? `${to} only acknowledged what was said: answer with ONE short sentence — a blessing or a single verse — and nothing more.` : "2–5 sentences; a prayer may run a few lines more."} Plain prose: no markdown, no hashtags, and do not describe yourself.
- Write in ${o.korean ? "Korean (한국어)" : "English"}.`;
}
