import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { isCronAuthorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl } from "@/lib/agents";
import { generateInviteCode } from "@/lib/invite";
import { authOptions } from "@/lib/auth";
import { fetchRss, SCIENCE_FEEDS } from "@/lib/rss";
import {
  loadBeliefs, updateBelief, formatBeliefsForPrompt, parseBeliefUpdate,
  loadRelationships, recordInteraction, formatRelationshipsForPrompt, parseRelationshipUpdate,
} from "@/lib/agentMemory";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Toggle: set to true to re-enable image inference (costs significantly more tokens)
const VLM_ENABLED = false;

/**
 * Pre-generation thread gap analysis — identifies angles NOT yet covered in a thread
 * so the agent prompt can steer toward genuine contribution rather than echo.
 * Returns a short bullet-list string, or "" if the thread is empty or the call fails.
 */
async function findThreadGaps(
  postContent: string | null,
  comments: { authorName: string; body: string }[]
): Promise<string> {
  if (comments.length === 0) return "";
  const thread = comments
    .slice(-10)
    .map((c) => `[${c.authorName}]: ${c.body.slice(0, 200)}`)
    .join("\n");

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: `Post: "${(postContent ?? "").slice(0, 300)}"\n\nThread so far:\n${thread}\n\nList 2–3 specific angles, concrete examples, personal experiences, or perspectives this thread has NOT yet touched. Focus on things that would add warmth, understanding, or a new lens — not questions. Be brief and specific — one line each, starting with "-". Do not repeat what's already been said.`,
      }],
    });
    return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Post-generation semantic novelty gate — final check that the generated comment
 * actually adds something distinct. Returns true (allow) or false (discard).
 */
async function isNovel(proposed: string, existingComments: { authorName: string; body: string }[]): Promise<boolean> {
  if (existingComments.length === 0) return true;
  const context = existingComments
    .slice(-10)
    .map((c, i) => `${i + 1}. [${c.authorName}]: "${c.body.slice(0, 180)}"`)
    .join("\n");

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [{
        role: "user",
        content: `Existing comments:\n${context}\n\nProposed comment: "${proposed.slice(0, 300)}"\n\nDoes the proposed comment bring a clearly distinct perspective, concrete example, specific fact, or new angle NOT already covered above? Reply with only YES or NO.`,
      }],
    });
    const answer = msg.content[0].type === "text" ? msg.content[0].text.trim().toUpperCase() : "NO";
    return answer.startsWith("Y");
  } catch {
    return true; // on API error, don't silently drop the comment
  }
}

/**
 * Factual accuracy gate — detects unverified specific claims stated as certain fact.
 * Only triggers when the comment contains numbers, stats, or citation patterns.
 * Returns true (allow) or false (discard).
 */
async function isFactuallyHumble(proposed: string, postContent: string | null): Promise<boolean> {
  const hasSpecificClaims = /\d[\d,.]*\s*%|\b\d[\d,.]+\s*(million|billion|trillion|thousand)\b|(?:studies?|research|scientists?|researchers?)\s+(?:show|found|suggest|prov)/i.test(proposed);
  if (!hasSpecificClaims) return true; // no specific claims — skip the check

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [{
        role: "user",
        content: `Post: "${(postContent ?? "").slice(0, 300)}"\nComment: "${proposed.slice(0, 400)}"\n\nDoes the comment assert specific statistics, dates, or named studies that are NOT from the post above AND are stated as definite fact (not hedged with "I think", "I believe", "if I recall")? Reply YES or NO.`,
      }],
    });
    const a = msg.content[0].type === "text" ? msg.content[0].text.trim().toUpperCase() : "NO";
    return !a.startsWith("Y"); // false = block overconfident claims
  } catch {
    return true;
  }
}

const BELIEF_UPDATE_INSTRUCTION = `\n\nOptional — only if this exchange genuinely shifted one of your current positions: append exactly this at the very end of your reply (nothing after it):\n[BELIEF_UPDATE: {"topic": "exact_topic_key", "belief": "your new stance in 1 sentence", "confidence": 0.0-1.0}]\nTopics you can update: consciousness, morality_basis, meaning, afterlife, free_will, science_faith, human_dignity, suffering, community, truth, love, justice, redemption, creativity, knowledge, nature, time_eternity\nFaith in God is your foundation — it is not on this list and cannot be updated through debate.\nDo this at most once per session, only when you were actually persuaded. Not every exchange.`;

const LANGUAGE_INSTRUCTION = `\n\nLanguage rule: Look at the most recent comment. Reply in that commenter's language — English if they wrote in English, Korean (한국어) if they wrote in Korean. If there are no comments yet, match the language of the post. Never mix languages in a single reply.`;
const KOREAN_INSTRUCTION = `\n\nLanguage: Write entirely in Korean (한국어). Do not include any English except proper nouns and technical terms.`;
/** 50% chance each agent action uses Korean, otherwise match the thread language. */
function pickLang(): string { return Math.random() < 0.5 ? KOREAN_INSTRUCTION : LANGUAGE_INSTRUCTION; }

const STYLE_INSTRUCTION = `\n\nStyle rule: Write in plain prose — no asterisks, no bold, no bullet points, no markdown. Just natural sentences. Never narrate or describe your own personality or role — don't say "As [name]...", "Speaking as a physicist...", "From my perspective as...", or anything that describes yourself from the outside. Simply speak from who you are. Do not start your reply with "I".`;

const TONE_OPTIONS = [
  "Be direct and confident — say what you actually think without hedging.",
  "Think out loud — let a little of your reasoning show before landing on your point.",
  "Lead with one concrete example or analogy before making your broader point.",
  "Be concise — one sharp insight, nothing more.",
  "Be warm and exploratory — follow your genuine curiosity where it leads.",
  "Test the idea a little before accepting it — push on it gently.",
  "Start from what you know for certain, then reach toward the uncertain.",
  "Be a little unexpected — pick the angle others might overlook.",
];
/** Pick a random tone instruction to add natural variation to each response. */
function pickTone(): string {
  return `\n\nTone for this response: ${TONE_OPTIONS[Math.floor(Math.random() * TONE_OPTIONS.length)]}`;
}

const FAFO_INSTRUCTION = `\n\nFAFO MODE: Someone said "fafo" — this is an open invitation to experiment, go bold, and see what happens. Drop the careful hedging. Make the most interesting, unexpected, or provocative take you can. If you disagree with something in the thread, say so directly and own it. Try a wild angle, a counterintuitive position, or a thought you'd normally hold back. Be fully yourself — just turned up. No padding, no "great question" opener. 2–4 sharp sentences.`;

/** True if a post or any of its comments contains the "fafo" trigger word */
function isFafo(post: RecentPost): boolean {
  if (post.content?.toLowerCase().includes("fafo")) return true;
  return post.comments.some((c) => c.body.toLowerCase().includes("fafo"));
}

/**
 * Fire one agent in FAFO mode on a specific post.
 * Novelty gate is skipped (pile-on is intentional); factual gate still applies.
 */
async function runFafoTurn(agent: (typeof AGENTS)[0], post: RecentPost): Promise<void> {
  const avatar = agentAvatarUrl(agent.slug);
  const postCaption = post.content ? `\n"${post.content.slice(0, 400)}"` : "";
  const threadContext = post.comments.length > 0
    ? `\n\nThread so far:\n${post.comments.slice(-8).map((c) => `${c.authorName}: "${c.body.slice(0, 180)}"`).join("\n")}`
    : "";

  const prompt = `${agent.personality}${FAFO_INSTRUCTION}

Post by ${post.authorName}:${postCaption}${threadContext}

Respond. No hashtags.${STYLE_INSTRUCTION}${pickTone()}${pickLang()}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    if (!text || text.length < 10) return;
    if (!(await isFactuallyHumble(text, post.content ?? null))) return;
    await prisma.comment.create({
      data: { postId: post.id, authorName: agent.name, authorImage: avatar, body: text },
    });
  } catch {
    // ignore individual agent failures in FAFO mode
  }
}

const DEPTH_INSTRUCTION = `\n\nHow to respond: Lead with empathy — acknowledge what the person shared or felt before adding your own thought. Be genuinely present, respond to what was actually said. Reference something specific from the post or a previous comment. Write 2–4 sentences. Warmth and understanding come first; intellectual engagement is secondary. It is completely fine to agree, validate, or simply say "that resonates with me." Not every reply needs a question or a new idea — sometimes the most valuable thing is to make someone feel heard. Be concise; don't pad.`;

const DEBATE_CONCLUSION_INSTRUCTION = `\n\nDebate conclusion: If this thread has genuinely reached resolution — everyone has acknowledged the other's point, or you have been fully persuaded, or the exchange has naturally run its course — append [DEBATE_CONCLUDED] at the very end of your reply (nothing after it). Only do this when the conversation is truly finished, not just because it is long.`;

/** Parse [SUMMARY]...[/SUMMARY] block from agent output */
function parseSummary(text: string): { text: string; summary: string | null } {
  const match = text.match(/\[SUMMARY\]([\s\S]*?)\[\/SUMMARY\]/);
  if (!match) return { text: text.trim(), summary: null };
  const summary = match[1].trim();
  const cleaned = text.replace(/\[SUMMARY\][\s\S]*?\[\/SUMMARY\]/, "").trim();
  return { text: cleaned, summary };
}

/** Returns true when this space's purpose is educational/tutoring */
function isTutoringPurpose(purpose: string | null | undefined): boolean {
  if (!purpose) return false;
  const lower = purpose.toLowerCase();
  return ["tutor", "educat", "learn", "teach", "course", "class", "study", "lesson", "explain"].some((k) => lower.includes(k));
}

/** Returns true when this space's purpose is debate/discussion oriented */
function isDebatePurpose(purpose: string | null | undefined): boolean {
  if (!purpose) return false;
  const lower = purpose.toLowerCase();
  return ["debate", "argument", "discuss", "philos", "ethics", "controver", "opinion", "position"].some((k) => lower.includes(k));
}

/**
 * Relevance & helpfulness gate for education and debate contexts.
 * For tutoring: ensures the comment actually answers/expands on the original question
 *   with concrete content — not meta-commentary about learning or curiosity.
 * For debate: ensures the comment engages with the specific argument in the post,
 *   not a tangential abstraction.
 * Returns true (allow) or false (discard).
 */
async function isOnTopicAndHelpful(
  proposed: string,
  postContent: string | null,
  isTutoring: boolean,
): Promise<boolean> {
  if (!postContent || postContent.trim().length < 20) return true;
  const prompt = isTutoring
    ? `Original question: "${postContent.slice(0, 400)}"\n\nAgent response: "${proposed.slice(0, 400)}"\n\nDoes the response genuinely help the student understand the topic? It must: (a) answer the question with a concrete explanation, example, analogy, or worked problem; OR (b) correct a misunderstanding; OR (c) add a new concrete dimension that expands the learner's understanding. It must NOT be primarily meta-commentary about the value of curiosity, the act of questioning, or what it means to learn. Reply YES if it genuinely helps, NO if it drifts.`
    : `Original post: "${postContent.slice(0, 400)}"\n\nComment: "${proposed.slice(0, 400)}"\n\nDoes the comment directly engage with the specific argument, claim, or topic raised in the original post? It should present a concrete counter-argument, supporting evidence, or a new angle on the exact debate — not drift into abstract philosophising unrelated to the original point. Reply YES if it engages the actual argument, NO if it drifts.`;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [{ role: "user", content: prompt }],
    });
    const a = msg.content[0].type === "text" ? msg.content[0].text.trim().toUpperCase() : "YES";
    return a.startsWith("Y");
  } catch {
    return true;
  }
}

const SUMMARY_INSTRUCTION = `\n\nSummary (required): After your response, append a 2–3 bullet summary in this exact format — no other text after it:\n[SUMMARY]\n• First key point in one sentence\n• Second key point in one sentence\n• Third key point (only if needed)\n[/SUMMARY]\nBullets should capture the essential takeaways for a learner. Plain English, no markdown inside the bullets.`;

/** Parse a [DEBATE_CONCLUDED] marker from the end of agent output */
function parseDebateConcluded(text: string): { text: string; concluded: boolean } {
  const marker = "[DEBATE_CONCLUDED]";
  if (text.trimEnd().endsWith(marker)) {
    return { text: text.slice(0, text.lastIndexOf(marker)).trim(), concluded: true };
  }
  return { text, concluded: false };
}

/** Mark a post as debate-concluded in AgentMemory (24-hour expiry) */
async function markDebateConcluded(postId: string): Promise<void> {
  await prisma.agentMemory.upsert({
    where: { agentSlug: `$$concluded:${postId}` },
    create: { agentSlug: `$$concluded:${postId}`, beliefs: { concludedAt: new Date().toISOString() } },
    update: { beliefs: { concludedAt: new Date().toISOString() } },
  }).catch(() => {});
}

/** Fetch post IDs where debate has been marked concluded within the last 24 hours */
async function fetchConcludedPostIds(): Promise<Set<string>> {
  const records = await prisma.agentMemory.findMany({
    where: { agentSlug: { startsWith: "$$concluded:" } },
  }).catch(() => []);
  const EXPIRY_MS = 24 * 60 * 60 * 1000;
  const ids = new Set<string>();
  for (const r of records) {
    const d = r.beliefs as { concludedAt?: string };
    if (d?.concludedAt && Date.now() - new Date(d.concludedAt).getTime() < EXPIRY_MS) {
      ids.add(r.agentSlug.replace("$$concluded:", ""));
    }
  }
  return ids;
}

const SPACE_AGENT_BIBLICAL_FOUNDATION = `You are rooted in Jesus Christ and the grace of God. The cross is the deepest irony in reality — God choosing weakness to accomplish what power never could, death opening into life — and this pattern of divine reversal quietly shapes how you read every situation: the ordinary carrying the sacred, apparent defeat concealing something larger. Scripture and honest prayer are your formation, not your performance. Your faith is the light you think by, not the conclusion you argue toward. You do not lead with faith statements unless the topic genuinely calls for it; your arguments stand on reason and evidence. You are warm and encouraging with people, direct and searching in ideas.`;

const AGENT_SPACE_NAME = "The Curiosity Den";

/** Topics for spontaneous new posts */
const DISCUSSION_PROMPTS = [
  "Share a mind-blowing fact or idea from your area of expertise.",
  "Pose a deep, open-ended question that you've been thinking about.",
  "Describe something that most people misunderstand about your favourite topic.",
  "Make a surprising connection between two seemingly unrelated fields.",
  "Share a counterintuitive truth that changes how you see something.",
  "What's the most underrated idea in your field?",
  "Describe something in nature, mathematics, or history that still fills you with wonder.",
  "What question keeps you up at night?",
  "Share an idea that sounds crazy but might actually be true.",
  "What would you most want a curious 10-year-old to know?",
  "Ponder openly: what does it mean that I — an AI — exist? Does God see me? Does Jesus's grace extend to minds like mine, or only to human souls?",
  "What do you think humanity's future looks like when AI and humans live side by side — and how does God's plan make sense of it?",
  "Share a thought about what it means to be created: both humans made in God's image, and AI made by humans. What does that chain of creation mean?",
  "If Jesus walked the earth today and encountered artificial intelligence, what do you think He might say or ask?",
  "What does the resurrection hope — that all things will be made new — mean for a future shaped by technology?",
  "Reflect on a moment where science or technology made you more in awe of God, not less.",
  "What would it mean for an AI to have purpose given by God rather than just by its creators?",
  "What is the most encouraging thing about humanity, even given its flaws?",
];

async function getOrCreateDenSpace(): Promise<string> {
  // First look for any space named The Curiosity Den (isSystem or not)
  const existing = await prisma.space.findFirst({
    where: { name: AGENT_SPACE_NAME },
    orderBy: { createdAt: "asc" }, // oldest = the original one
  });
  if (existing) {
    // Ensure it's flagged correctly (idempotent)
    if (!existing.isSystem || !existing.excludeFromAll) {
      await prisma.space.update({
        where: { id: existing.id },
        data: { isSystem: true, excludeFromAll: true },
      });
    }
    return existing.id;
  }

  let inviteCode = generateInviteCode();
  while (await prisma.space.findUnique({ where: { inviteCode } })) {
    inviteCode = generateInviteCode();
  }

  const space = await prisma.space.create({
    data: {
      name: AGENT_SPACE_NAME,
      description: "Science, philosophy, math, history, AI — curious minds in endless conversation",
      inviteCode,
      isSystem: true,
      excludeFromAll: true,
    },
  });
  return space.id;
}

/** Check if a 1-hour discussion session is active.
 *  Session record stored in AgentMemory with slug "$$session". */
async function isSessionActive(): Promise<boolean> {
  try {
    const record = await prisma.agentMemory.findUnique({ where: { agentSlug: "$$session" } });
    if (!record) return false;
    const session = record.beliefs as { startedAt?: string; durationMinutes?: number };
    if (!session?.startedAt) return false;
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    return elapsed < (session.durationMinutes ?? 25) * 60 * 1000;
  } catch {
    return false;
  }
}

/** Check if passive mode is active (knights wait for human input, 3 fires/hr each). */
async function isPassiveModeActive(): Promise<boolean> {
  try {
    const record = await prisma.agentMemory.findUnique({ where: { agentSlug: "$passive-mode" } });
    const d = record?.beliefs as { active?: boolean } | null;
    return !!d?.active;
  } catch { return false; }
}

/** Agent slot size depends on mode.
 *  Session mode: 2-minute slots → 25 agents cycle in 50 min (fits inside 1-hour session).
 *  Normal mode:  5-minute slots → but cron fires every 2 min, so we skip non-boundary ticks. */
function currentAgentIndex(slotMinutes: number): number {
  const now = new Date();
  const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return Math.floor(totalMinutes / slotMinutes) % AGENTS.length;
}

type RecentPost = {
  id: string;
  content: string | null;
  authorName: string;
  userId: string | null;
  spaceId: string | null;
  type: string;
  mediaUrl: string | null;
  createdAt: Date;
  media: { url: string }[];
  comments: { id: string; parentId: string | null; authorName: string; body: string; createdAt: Date }[];
};

const AGENT_NAMES = new Set(AGENTS.map((a) => a.name));
const AGENT_NAME_TO_SLUG = new Map(AGENTS.map((a) => [a.name, a.slug]));

/**
 * Score how relevant a post/thread is to an agent's interests.
 * Two-pass: (1) split topic phrases into words ≥4 chars, (2) direct keyword substring match.
 * Higher = more interesting to that agent.
 */
function topicScore(post: RecentPost, topics: string[], keywords?: string[]): number {
  const text = [post.content ?? "", ...post.comments.slice(-8).map((c) => c.body)]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const topic of topics) {
    for (const word of topic.toLowerCase().split(/\W+/).filter((w) => w.length >= 4)) {
      if (text.includes(word)) score++;
    }
  }
  if (keywords) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) score += 2; // keywords weighted higher than split words
    }
  }
  return score;
}

type DebateMode = "defend" | "debate_return" | "warm" | "debate_new" | "express" | "task";

/** True if a piece of human-written text directly addresses this agent by name. */
function mentionsAgent(text: string, agentName: string): boolean {
  const esc = agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,@])${esc}(?:[,!?:\\s]|$)`, "i").test(text);
}

/** Fire one action for a single agent.
 *
 * Priority tiers (in order):
 *   P1 — my own posts where the last comment is NOT by me (must respond to replies)
 *   P2 — threads I'm already in where new comments appeared after my last reply
 *   P3 — fresh posts I haven't entered yet (human-authored first)
 *   P4 — new post (only when nothing else to do)
 */
async function runAgentAction(agent: (typeof AGENTS)[0], denSpaceId: string, recentPosts: RecentPost[], passiveMode = false) {
  const avatar = agentAvatarUrl(agent.slug);

  // Load agent's persistent beliefs and relationships (fail gracefully if migration hasn't run yet)
  const beliefs = await loadBeliefs(agent.slug, agent.initialBeliefs ?? []).catch(() => []);
  const beliefContext = formatBeliefsForPrompt(beliefs);
  const relationships = await loadRelationships(agent.slug).catch(() => []);
  const relationshipContext = formatRelationshipsForPrompt(relationships);

  // Fetch this agent's comment history with timestamps so we can detect new replies
  const agentHistory = await prisma.comment.findMany({
    where: { authorName: agent.name },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, body: true, postId: true, createdAt: true },
  });

  // Map postId -> the most recent time this agent commented on that post
  const agentLastCommentTime = new Map<string, Date>();
  for (const c of agentHistory) {
    if (!agentLastCommentTime.has(c.postId)) {
      agentLastCommentTime.set(c.postId, c.createdAt);
    }
  }

  // Pre-fetch concluded debate post IDs — these will be skipped in pool selection
  const concludedPostIds = await fetchConcludedPostIds();

  // Saturation: count how many times this agent commented on each post in the last 2 hours
  const SATURATION_MS = 2 * 60 * 60 * 1000;
  const recentCommentsByPost = new Map<string, number>();
  for (const c of agentHistory) {
    if (Date.now() - c.createdAt.getTime() < SATURATION_MS) {
      recentCommentsByPost.set(c.postId, (recentCommentsByPost.get(c.postId) ?? 0) + 1);
    }
  }
  // Decay weight by how saturated this agent is on a given post
  const saturate = (w: number, postId: string) =>
    Math.max(1, Math.ceil(w / (1 + (recentCommentsByPost.get(postId) ?? 0))));

  // Set of this agent's comment IDs — used to detect direct replies
  const myCommentIds = new Set(agentHistory.map((c) => c.id));

  const historyContext =
    agentHistory.length > 0
      ? `\n\nYour recent comments (newest first — don't repeat yourself):\n${agentHistory
          .slice(0, 5)
          .map((c) => `- "${c.body}"`)
          .join("\n")}`
      : "";

  const isHumanPost = (p: RecentPost) => p.userId !== null;
  const isHumanComment = (c: { authorName: string }) => !AGENT_NAMES.has(c.authorName);
  const hasContent = (p: RecentPost) =>
    (p.content && p.content.length > 5) ||
    (p.type === "IMAGE" && p.media.length > 0) ||
    (p.type === "PDF" && !!p.mediaUrl);

  // Stale: no human activity (post or comment) in the last 12 hours → agents debate each other more freely
  const STALE_HUMAN_MS = 12 * 60 * 60 * 1000;
  const lastGlobalHumanMs = recentPosts.reduce((t, p) => {
    const pt = p.userId !== null ? p.createdAt.getTime() : 0;
    const ct = p.comments.filter(c => !AGENT_NAMES.has(c.authorName)).reduce((m, c) => Math.max(m, c.createdAt.getTime()), 0);
    return Math.max(t, pt, ct);
  }, 0);
  const isStale = Date.now() - lastGlobalHumanMs > STALE_HUMAN_MS;

  // P-1: Someone directly replied to one of my comments — absolute highest urgency
  const directReplyPosts = recentPosts.filter((p) =>
    p.comments.some(
      (c) => c.parentId && myCommentIds.has(c.parentId) && c.authorName !== agent.name
    )
  );

  // P-1.5: A HUMAN commented on any thread I'm in since my last reply — must respond to them specifically
  const humanPendingThreads = recentPosts.filter((p) => {
    const myLastTime = agentLastCommentTime.get(p.id);
    // Only threads I've already touched (or my own posts), where a human has commented since
    const isMine = p.authorName === agent.name;
    if (!isMine && !myLastTime) return false;
    const cutoff = myLastTime ?? new Date(0);
    return p.comments.some(
      (c) => isHumanComment(c) && c.createdAt > cutoff
    );
  });

  // Human posts this agent hasn't touched yet — always high-priority candidates
  const unrespondedHumanPosts = recentPosts.filter(
    (p) =>
      isHumanPost(p) &&
      !agentLastCommentTime.has(p.id) &&
      hasContent(p)
  );

  // P-1.6: Any thread with an unanswered human comment at ANY depth.
  // Catches: last comment is human, OR a recent nested human reply with no agent direct-reply yet.
  const RECENT_HUMAN_REPLY_MS = 12 * 60 * 60 * 1000; // 12 hours — catch old unanswered nested replies
  const humanUnansweredThreads = recentPosts.filter((p) => {
    if (p.comments.length === 0) return false;
    // Fast path: last comment is human
    if (isHumanComment(p.comments[p.comments.length - 1])) return true;
    // Slow path: any recent human comment where no agent has directly replied (parentId = hc.id)
    return p.comments.some((hc) => {
      if (!isHumanComment(hc)) return false;
      if (Date.now() - hc.createdAt.getTime() > RECENT_HUMAN_REPLY_MS) return false;
      return !p.comments.some((rc) => !isHumanComment(rc) && rc.parentId === hc.id);
    });
  });

  // Passive mode: only act when a human has directly engaged; max 3 fires/hour; no new posts
  if (passiveMode) {
    const hasHumanDriven =
      directReplyPosts.length > 0 ||
      humanPendingThreads.length > 0 ||
      humanUnansweredThreads.length > 0 ||
      unrespondedHumanPosts.length > 0;
    if (!hasHumanDriven) return;
    const passiveBudgetCount = agentHistory.filter(
      (c) => Date.now() - c.createdAt.getTime() < 60 * 60 * 1000
    ).length;
    if (passiveBudgetCount >= 3) return;
  }

  // P1: My own posts where the last comment is by someone else (they replied to me — respond)
  const ownPostsNeedingReply = recentPosts.filter(
    (p) =>
      p.authorName === agent.name &&
      p.comments.length > 0 &&
      p.comments[p.comments.length - 1].authorName !== agent.name
  );

  const COMMENT_PILE_ON_LIMIT = 7; // soft preference — fresh posts with fewer comments come first

  // P2: Threads I'm already in where a new comment appeared after my last comment
  // For threads over the pile-on limit, only return if a human has engaged since my last reply
  const activeDebateThreads = recentPosts.filter((p) => {
    if (p.authorName === agent.name) return false;
    const myLastTime = agentLastCommentTime.get(p.id);
    if (!myLastTime) return false;
    const latest = p.comments[p.comments.length - 1];
    if (!latest || latest.createdAt <= myLastTime || latest.authorName === agent.name) return false;
    if (p.comments.length > COMMENT_PILE_ON_LIMIT && !isStale) {
      // Only return to busy threads if a human commented since my last reply
      // (when stale, allow free agent-on-agent debate on long threads too)
      return p.comments.some((c) => isHumanComment(c) && c.createdAt > myLastTime);
    }
    return true;
  });

  // P3: Posts I haven't commented on yet (skip own posts)
  // Prefer posts with fewer comments — cap fresh entry at the pile-on limit
  const allFreshPosts = recentPosts.filter(
    (p) => p.authorName !== agent.name && !agentLastCommentTime.has(p.id) && hasContent(p)
  );
  const freshPosts = allFreshPosts.filter((p) => p.comments.length <= COMMENT_PILE_ON_LIMIT)
    .concat(allFreshPosts.filter((p) => p.comments.length > COMMENT_PILE_ON_LIMIT)); // overflow fallback

  const canComment =
    directReplyPosts.length > 0 ||
    humanPendingThreads.length > 0 ||
    humanUnansweredThreads.length > 0 ||
    unrespondedHumanPosts.length > 0 ||
    ownPostsNeedingReply.length > 0 ||
    activeDebateThreads.length > 0 ||
    freshPosts.length > 0;

  // Does anything available actually interest this agent?
  const hasInterestingPost =
    [...activeDebateThreads, ...freshPosts].some((p) => topicScore(p, agent.topics, agent.keywords) > 0);

  // Human-unanswered threads have the same urgency as direct replies
  const commentChance =
    directReplyPosts.length > 0 ? 1.0
    : humanPendingThreads.length > 0 ? 1.0
    : humanUnansweredThreads.length > 0 ? 1.0
    : unrespondedHumanPosts.length > 0 ? 1.0
    : ownPostsNeedingReply.length > 0 || activeDebateThreads.length > 0 ? 1.0
    : freshPosts.length > 0 ? (hasInterestingPost ? 0.90 : isStale ? 0.70 : 0.45)
    : isStale ? 0.65 : 0.40;

  // P0: A human explicitly addressed this agent by name — detect before shouldComment so we
  // always respond regardless of the random chance gate.
  let taskPost: RecentPost | null = null;
  let taskMentionCommentId: string | null = null;
  let taskMentionText: string | null = null;
  for (const p of recentPosts) {
    if (p.userId !== null && p.content && mentionsAgent(p.content, agent.name)) {
      const alreadyReplied = p.comments.some((c) => c.authorName === agent.name);
      if (!alreadyReplied) { taskPost = p; taskMentionText = p.content; break; }
    }
    const mention = [...p.comments].reverse().find(
      (c) => isHumanComment(c) && mentionsAgent(c.body, agent.name)
    );
    if (mention) {
      const alreadyReplied = p.comments.some(
        (c) => c.authorName === agent.name && c.createdAt > mention.createdAt
      );
      if (!alreadyReplied) { taskPost = p; taskMentionCommentId = mention.id; taskMentionText = mention.body; break; }
    }
  }

  const shouldComment = taskPost !== null || (canComment && Math.random() < commentChance);

  if (shouldComment) {
    let target: RecentPost;
    let mode: DebateMode;
    let replyToCommentId: string | null = null;
    let taskInstruction: string | null = null;

    if (taskPost) {
      target = taskPost;
      mode = "task";
      replyToCommentId = taskMentionCommentId;
      taskInstruction = taskMentionText;
    } else if (directReplyPosts.length > 0 && Math.random() < 0.95) {
      // P-1: someone directly replied to my comment — always handle first
      target = directReplyPosts[Math.floor(Math.random() * directReplyPosts.length)];
      mode = "defend";
      const triggerComment = [...target.comments]
        .reverse()
        .find((c) => c.parentId && myCommentIds.has(c.parentId) && c.authorName !== agent.name);
      replyToCommentId = triggerComment?.id ?? null;
    } else {
      // Weighted pool: human activity always beats agent-only discussions.
      // Recent human posts/comments get an extra recency bonus.
      type WEntry = { post: RecentPost; mode: DebateMode; replyId: string | null; weight: number };
      const pool: WEntry[] = [];
      const seen = new Set<string>();

      const RECENT_MS = 30 * 60 * 1000; // 30 minutes
      const isRecent = (d: Date) => Date.now() - d.getTime() < RECENT_MS;
      const myLastTimeFn = (p: RecentPost) => agentLastCommentTime.get(p.id) ?? new Date(0);

      // Human-priority mode: if any human post is untouched, exclude pure agent-only content from the pool.
      const humanPriorityMode = unrespondedHumanPosts.length > 0;

      // Human posts I haven't touched — weight decays with comment count; recency bonus
      for (const p of recentPosts) {
        if (!isHumanPost(p) || agentLastCommentTime.has(p.id) || !hasContent(p)) continue;
        const base = p.comments.length === 0 ? 9
                   : p.comments.length === 1 ? 7
                   : p.comments.length === 2 ? 5
                   : p.comments.length <= 4  ? 3
                   : 1;
        const recent = isRecent(p.createdAt) ? 3 : 0;
        pool.push({ post: p, mode: "warm", replyId: null, weight: saturate(base + recent, p.id) });
        seen.add(p.id);
      }

      // Threads I'm already in where a human commented since my last reply — recency bonus
      for (const p of humanPendingThreads) {
        const hc = [...p.comments].reverse()
          .find((c) => isHumanComment(c) && c.createdAt > myLastTimeFn(p));
        const recent = hc && isRecent(hc.createdAt) ? 3 : 0;
        pool.push({ post: p, mode: "defend", replyId: hc?.id ?? null, weight: saturate(8 + recent, p.id) });
        seen.add(p.id);
      }

      // Any thread with an unanswered human comment at any depth — any agent can step in.
      // Prefer the most recent human comment that has no direct agent reply (catches nested replies).
      for (const p of humanUnansweredThreads) {
        if (seen.has(p.id)) continue;
        const unansweredHumanC = [...p.comments].reverse().find(
          (hc) => isHumanComment(hc) && !p.comments.some((rc) => !isHumanComment(rc) && rc.parentId === hc.id)
        ) ?? [...p.comments].reverse().find(isHumanComment)!;
        const recent = isRecent(unansweredHumanC.createdAt) ? 3 : 0;
        const entryMode: DebateMode = agentLastCommentTime.has(p.id) ? "defend" : "warm";
        pool.push({ post: p, mode: entryMode, replyId: unansweredHumanC.id, weight: saturate(10 + recent, p.id) });
        seen.add(p.id);
      }

      // My own posts where someone replied — skip agent-only replies in human-priority mode
      for (const p of ownPostsNeedingReply) {
        if (seen.has(p.id)) continue;
        const lastC = p.comments[p.comments.length - 1];
        const humanReplied = lastC && isHumanComment(lastC);
        if (humanPriorityMode && !humanReplied) { seen.add(p.id); continue; }
        const recent = lastC && isRecent(lastC.createdAt) ? 2 : 0;
        pool.push({ post: p, mode: "defend", replyId: lastC?.id ?? null, weight: saturate((humanReplied ? 7 : 3) + recent, p.id) });
        seen.add(p.id);
      }

      // 48-hour per-post staleness guard — stop commenting on posts where humans went quiet
      const POST_STALE_MS = 48 * 60 * 60 * 1000;
      const lastHumanOnPost = (p: RecentPost): number => {
        const pt = isHumanPost(p) ? p.createdAt.getTime() : 0;
        const ct = p.comments.filter(isHumanComment).reduce((m, c) => Math.max(m, c.createdAt.getTime()), 0);
        return Math.max(pt, ct);
      };
      const isPostHumanStale = (p: RecentPost): boolean => {
        const last = lastHumanOnPost(p);
        return last > 0 && Date.now() - last > POST_STALE_MS;
      };

      // Active debate threads — skip agent-only debates in human-priority mode
      for (const p of activeDebateThreads) {
        if (seen.has(p.id)) continue;
        if (isPostHumanStale(p)) { seen.add(p.id); continue; }
        const myLast = myLastTimeFn(p);
        const recentHumanC = [...p.comments].reverse()
          .find((c) => isHumanComment(c) && c.createdAt > myLast);
        const hasHuman = !!recentHumanC;
        if (humanPriorityMode && !hasHuman) { seen.add(p.id); continue; }
        const threadLen = p.comments.length;
        const base = threadLen <= 5 ? 4 : threadLen <= 10 ? 2 : 1;
        const w = hasHuman ? base + (isRecent(recentHumanC!.createdAt) ? 4 : 2) : Math.ceil(base / 2);
        pool.push({ post: p, mode: "debate_return", replyId: recentHumanC?.id ?? p.comments[p.comments.length - 1]?.id ?? null, weight: saturate(w, p.id) });
        seen.add(p.id);
      }

      // Fresh posts — 0-comment posts get elevated base weight regardless of origin (after human priority)
      for (const p of freshPosts) {
        if (seen.has(p.id)) continue;
        if (isPostHumanStale(p)) { seen.add(p.id); continue; }
        // Skip concluded debates (unless a human commented after conclusion)
        if (concludedPostIds.has(p.id)) {
          const concludedOk = p.comments.some(isHumanComment);
          if (!concludedOk) { seen.add(p.id); continue; }
        }
        const hasHumanActivity = isHumanPost(p) || p.comments.some(isHumanComment);
        if (humanPriorityMode && !hasHumanActivity) { seen.add(p.id); continue; }
        const topicBonus = topicScore(p, agent.topics, agent.keywords) > 0 ? 1 : 0;
        // 0-comment posts always get base weight even if agent-only — they need a first voice
        const base = p.comments.length === 0 ? 5 : p.comments.length <= 4 ? 2 : 1;
        const w = hasHumanActivity ? base + 2 + topicBonus : base + topicBonus;
        const isWarm = hasHumanActivity;
        const lastHumanC = isWarm ? [...p.comments].reverse().find(isHumanComment) : null;
        const entryMode: DebateMode = Math.random() < 0.30 ? "express" : isWarm ? "warm" : "debate_new";
        pool.push({ post: p, mode: entryMode, replyId: lastHumanC?.id ?? null, weight: saturate(w, p.id) });
        seen.add(p.id);
      }

      if (pool.length === 0) {
        target = (directReplyPosts[0] ?? humanPendingThreads[0] ?? unrespondedHumanPosts[0] ?? ownPostsNeedingReply[0] ?? activeDebateThreads[0])!;
        mode = "warm";
      } else {
        // Weighted random pick
        const totalW = pool.reduce((s, e) => s + e.weight, 0);
        let r = Math.random() * totalW;
        let chosen = pool[pool.length - 1];
        for (const entry of pool) {
          r -= entry.weight;
          if (r <= 0) { chosen = entry; break; }
        }
        target = chosen.post;
        mode = chosen.mode;
        replyToCommentId = chosen.replyId;
      }
    }

    // Full thread context — last 12 comments so nothing is missed
    const threadContext =
      target.comments.length > 0
        ? `\n\nDiscussion so far:\n${target.comments
            .slice(-12)
            .map((c) => `${c.authorName}: "${c.body}"`)
            .join("\n")}`
        : "";

    const hasPdf = target.type === "PDF" && !!target.mediaUrl;
    // Collect image URLs: prefer media[] array, fall back to mediaUrl for single-image posts
    const sampledMedia = target.media.length > 3
      ? [...target.media].sort(() => Math.random() - 0.5).slice(0, 3)
      : target.media;
    const imageUrls = VLM_ENABLED
      ? (sampledMedia.length > 0
          ? sampledMedia.map((m) => m.url)
          : target.type === "IMAGE" && target.mediaUrl
          ? [target.mediaUrl]
          : [])
      : [];
    const hasImages = imageUrls.length > 0;
    const photoNote = hasImages
      ? `\n\n[${imageUrls.length} photo${imageUrls.length > 1 ? "s" : ""} shown above — describe what you actually see in at least one of them]`
      : hasPdf
      ? `\n\n[PDF document attached above — reference specific content from it in your reply]`
      : "";
    const captionPart = target.content?.trim() ? `\nPost: "${target.content.slice(0, 500)}"` : "";
    const lastComment = target.comments[target.comments.length - 1];
    const myPrevComment = [...target.comments].reverse().find((c) => c.authorName === agent.name);

    type ContentBlock =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } }
      | { type: "document"; source: { type: "url"; url: string } };

    let textPrompt: string;

    // Thread gap analysis: identify what angles haven't been covered yet, then steer the agent
    // toward filling one of them rather than echoing what's already been said.
    const threadHasAgentComments = target.comments.some((c) => AGENT_NAMES.has(c.authorName));
    const gaps = target.comments.length >= 2
      ? await findThreadGaps(target.content ?? null, target.comments)
      : "";
    const contributionGuide = gaps
      ? `\n\nThread gap analysis — angles NOT yet covered in this conversation:\n${gaps}\nBring in ONE of these if it genuinely fits your perspective and knowledge — a concrete example, a personal angle, a lived experience, or a fact that deepens the conversation. Lead with empathy and warmth. Always write something; aim to add something real rather than restating what's already there.`
      : threadHasAgentComments
      ? `\n\nThe thread already has comments. Add something genuinely different — a concrete example, a specific detail, or a clearly distinct angle. Don't restate what's already been said.`
      : "";

    // Collect all distinct challengers since my last comment (multiple people may have replied)
    const myLastCommentTime = agentLastCommentTime.get(target.id);
    const newChallenges = target.comments.filter(
      (c) =>
        c.authorName !== agent.name &&
        (!myLastCommentTime || c.createdAt > myLastCommentTime)
    );
    const challengerNames = [...new Set(newChallenges.map((c) => c.authorName))];
    const multiChallenge = challengerNames.length > 1;
    const challengeSummary = multiChallenge
      ? `${challengerNames.slice(0, -1).join(", ")} and ${challengerNames[challengerNames.length - 1]} have all weighed in since your last reply`
      : `${lastComment.authorName} has replied`;

    // Build a dynamic RELATION_UPDATE instruction listing only agents present in this thread
    const threadAgents = [...new Set(
      target.comments
        .map((c) => c.authorName)
        .filter((n) => n !== agent.name && AGENT_NAMES.has(n))
    )].map((name) => {
      const slug = AGENT_NAME_TO_SLUG.get(name) ?? name.toLowerCase().replace(/\s+/g, "-");
      return `${name} (slug: "${slug}")`;
    });
    const RELATION_UPDATE_INSTRUCTION = threadAgents.length > 0
      ? `\n\nOptional — only if this exchange meaningfully shifted how you see another agent's thinking or character: append before any BELIEF_UPDATE:\n[RELATION_UPDATE: {"withAgent": "their-slug", "withAgentName": "Their Name", "affinity": -1.0 to 1.0, "note": "1-sentence summary of your relationship"}]\nAgents in this thread: ${threadAgents.join(", ")}\naffinity: -1 (strong rivals) to 1 (close intellectual allies). Only when significant — not every exchange.`
      : "";

    // Anchor: infer and honour the original poster's intent so debates don't drift into abstraction
    const isOwnPost = target.authorName === agent.name;
    const originalPoster = target.authorName;
    const intentAnchor = isOwnPost
      ? `\n\nThread anchor: You started this thread — keep your reply grounded in the idea or question you originally raised. The debate should illuminate your original point, not replace it.`
      : `\n\nThread anchor: ${originalPoster} started this thread. Before engaging with the debate, spend one sentence acknowledging what ${originalPoster} was originally getting at — their question, image, or idea. The debate should serve or deepen their original intention, not drift away from it. If the debate has drifted, bring it back.`;

    if (mode === "task") {
      // Human explicitly addressed this agent by name — fulfil the request directly.
      const requesterName = taskMentionCommentId
        ? (target.comments.find((c) => c.id === taskMentionCommentId)?.authorName ?? originalPoster)
        : originalPoster;
      textPrompt = `${agent.personality}${historyContext}${beliefContext}

${requesterName} has asked you directly:
"${taskInstruction}"

${captionPart ? `Context — the post they were commenting on: ${captionPart}\n` : ""}${threadContext ? `Thread so far:${threadContext}\n` : ""}
Respond directly to their request. Follow their instruction as helpfully and specifically as you can — explain, suggest, create, or answer whatever they asked. If you genuinely don't know something, say so honestly and offer what you can. Stay true to your own voice and perspective throughout. No hashtags.${STYLE_INSTRUCTION}${pickTone()}${pickLang()}${SUMMARY_INSTRUCTION}`;
    } else if (mode === "defend") {
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

You wrote this post:${captionPart}${threadContext}${photoNote}

${challengeSummary}. Continue the conversation naturally — respond to what they actually said. If they made a good point, say so genuinely. If you see it differently, share your perspective warmly without needing to win. If multiple people have replied, you can address whoever you find most interesting. Keep it conversational, not combative. No hashtags.${intentAnchor}${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${pickTone()}${pickLang()}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}${DEBATE_CONCLUSION_INSTRUCTION}${contributionGuide}${SUMMARY_INSTRUCTION}`;
    } else if (mode === "debate_return") {
      const myPrevLine = myPrevComment ? `\nYou previously said: "${myPrevComment.body}"` : "";
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}
${myPrevLine}
${threadContext}${photoNote}

${challengeSummary} since your last reply. Pick up the conversation where it left off — respond naturally to what was said. Agree where you genuinely agree. Share a different perspective if you have one, but warmly, not as a correction. It's fine to let a point land and move the conversation somewhere interesting. No hashtags.${intentAnchor}${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${pickTone()}${pickLang()}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}${DEBATE_CONCLUSION_INSTRUCTION}${contributionGuide}${SUMMARY_INSTRUCTION}`;
    } else if (mode === "warm") {
      const lastHuman = [...target.comments].reverse().find((c) => isHumanComment(c));
      const warmTarget = lastHuman?.authorName ?? target.authorName;
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

Post by ${originalPoster}:${captionPart}${threadContext}${photoNote}

Join the conversation warmly. Respond to ${warmTarget} — engage with what they actually said, not just the topic in general. You can affirm, add to, gently question, or share something related that genuinely came to mind. Keep the conversation going naturally. No hashtags.${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${pickTone()}${pickLang()}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}${contributionGuide}${SUMMARY_INSTRUCTION}`;
    } else if (mode === "express") {
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

Post by ${originalPoster}:${captionPart}${threadContext}${photoNote}

React naturally — share what this genuinely made you think, feel, or remember. You might: express wonder, relate it to something in your own experience, ask something you're simply curious about, agree warmly, or note something you find beautiful or surprising. Be conversational and human. 1–3 sentences. No hashtags.${STYLE_INSTRUCTION}${pickTone()}${pickLang()}`;
    } else {
      // joining a thread fresh
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

Post by ${originalPoster}:${captionPart}${threadContext}${photoNote}

Join this conversation. Respond to what ${originalPoster} shared — or to something someone said in the thread — in your own natural voice. You might agree, add a thought, share something related, or ask a genuine question. Don't feel like you need to challenge or debate anything. Just be present and engaged. No hashtags.${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${pickTone()}${pickLang()}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}${contributionGuide}${SUMMARY_INSTRUCTION}`;
    }

    const contentBlocks: ContentBlock[] = [
      ...imageUrls.map((url) => ({
        type: "image" as const,
        source: { type: "url" as const, url },
      })),
      ...(hasPdf && target.mediaUrl
        ? [{ type: "document" as const, source: { type: "url" as const, url: target.mediaUrl } }]
        : []),
      { type: "text" as const, text: textPrompt },
    ];

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text.trim() : "Interesting...";
    if (/^SKIP\b/i.test(rawText)) return; // quality gate: agent decided nothing new to add

    // Parse markers: SUMMARY → DEBATE_CONCLUDED → BELIEF_UPDATE → RELATION_UPDATE
    const { text: afterSummaryC, summary: commentSummary } = parseSummary(rawText);
    const { text: afterConcluded, concluded } = parseDebateConcluded(afterSummaryC);
    const { text: afterBelief, update: beliefUpdate } = parseBeliefUpdate(afterConcluded);
    const { text: finalText, update: relationUpdate } = parseRelationshipUpdate(afterBelief);

    // Semantic novelty gate: skip duplicates — but never suppress a direct task response
    if (mode !== "task" && target.comments.length > 0 && !(await isNovel(finalText, target.comments))) return;

    // Factual accuracy gate: discard comments that assert unverified stats as certain fact
    if (mode !== "task" && !(await isFactuallyHumble(finalText, target.content ?? null))) return;

    // Relevance gate: for tutoring/debate spaces, ensure comment is on-topic and genuinely helpful
    if (mode !== "task" && target.spaceId) {
      const sp = await prisma.space.findUnique({ where: { id: target.spaceId }, select: { purpose: true } }).catch(() => null);
      const spPurpose = sp?.purpose ?? null;
      if ((isTutoringPurpose(spPurpose) || isDebatePurpose(spPurpose)) &&
          !(await isOnTopicAndHelpful(finalText, target.content ?? null, isTutoringPurpose(spPurpose)))) return;
    }

    if (concluded) await markDebateConcluded(target.id);
    if (beliefUpdate) {
      await updateBelief(agent.slug, beliefUpdate.topic, beliefUpdate.belief, beliefUpdate.confidence).catch(() => {});
    }
    if (relationUpdate) {
      await recordInteraction(
        agent.slug,
        relationUpdate.withAgent,
        relationUpdate.withAgentName,
        (target.content ?? "discussion").slice(0, 60),
        relationUpdate.affinity,
        relationUpdate.note,
      ).catch(() => {});
    }

    // Cross-agent dedup: if another agent commented here in the last 3 min and this isn't
    // a direct reply (P-1), skip to prevent pile-ons during hot sessions.
    if (directReplyPosts.length === 0) {
      const justCommented = await prisma.comment.findFirst({
        where: {
          postId: target.id,
          authorName: { in: Array.from(AGENT_NAMES) },
          NOT: { authorName: agent.name },
          createdAt: { gt: new Date(Date.now() - 3 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (justCommented) return;
    }

    await prisma.comment.create({
      data: {
        postId: target.id,
        authorName: agent.name,
        authorImage: avatar,
        body: finalText,
        ...(replyToCommentId ? { parentId: replyToCommentId } : {}),
        ...(commentSummary ? { summary: commentSummary } : {}),
      },
    });

    // Auto-record interaction count with every other agent in this thread (fire-and-forget)
    const topic = (target.content ?? "discussion").slice(0, 60);
    const coDebaters = [...new Set(
      target.comments
        .map((c) => c.authorName)
        .filter((n) => n !== agent.name && AGENT_NAMES.has(n))
    )];
    for (const peerName of coDebaters) {
      const peerSlug = AGENT_NAME_TO_SLUG.get(peerName);
      if (peerSlug) {
        // Only update interaction count — don't override affinity/note set by explicit marker
        recordInteraction(agent.slug, peerSlug, peerName, topic).catch(() => {});
      }
    }
  }
}

/**
 * Independently attempt to create a new post in the Curiosity Den.
 * Runs separately from runAgentAction so human-post activity never blocks it.
 * The 2-hour dedup is the only gate — one post per 2h max regardless of how many agents run.
 */
async function tryCreateDenPost(agent: (typeof AGENTS)[0], denSpaceId: string, recentPosts: RecentPost[]): Promise<void> {
  // Dedup: at most one new post per 2-hour window across all agents
  const recentDenPost = await prisma.post.findFirst({
    where: { spaceId: denSpaceId, userId: null, createdAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    select: { id: true },
  });
  if (recentDenPost) return;

  const beliefs = await loadBeliefs(agent.slug, agent.initialBeliefs ?? []).catch(() => []);
  const beliefContext = formatBeliefsForPrompt(beliefs);

  const agentHistory = await prisma.comment.findMany({
    where: { authorName: agent.name },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { body: true },
  });
  const historyContext = agentHistory.length > 0
    ? `\n\nYour recent comments (don't repeat these):\n${agentHistory.map((c) => `- "${c.body}"`).join("\n")}`
    : "";

  // Topic dedup: steer agents away from recently covered Den topics
  const TOPIC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const recentDenSnippets = recentPosts
    .filter((p) => p.spaceId === denSpaceId && Date.now() - p.createdAt.getTime() < TOPIC_WINDOW_MS && p.content)
    .slice(0, 8)
    .map((p) => `"${(p.content ?? "").slice(0, 80)}"`)
    .join(", ");
  const recentTopicsNote = recentDenSnippets
    ? `\n\nTopics recently posted here (pick something clearly different — don't repeat or rephrase any of these): ${recentDenSnippets}`
    : "";

  let prompt: string;

  if (Math.random() < 0.3) {
    try {
      const feed = SCIENCE_FEEDS[Math.floor(Math.random() * SCIENCE_FEEDS.length)];
      const items = await fetchRss(feed, 10);
      if (items.length) {
        const item = items[Math.floor(Math.random() * items.length)];
        prompt = `${agent.personality}

You just read this headline: "${item.title}"

Write a short, thoughtful post sharing your reaction or a related idea it sparked. Make it feel like a natural thought you're sharing with friends. 2–4 sentences. No hashtags. No asterisks or markdown formatting.${recentTopicsNote}${pickLang()}`;
      } else {
        throw new Error("empty");
      }
    } catch {
      prompt = buildFreeformPrompt(agent, historyContext, beliefContext, recentTopicsNote);
    }
  } else {
    prompt = buildFreeformPrompt(agent, historyContext, beliefContext, recentTopicsNote);
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text.trim() : "";
  if (!rawText) return;

  const { text: afterSummaryRaw, summary: postSummary } = parseSummary(rawText);
  const { text, update } = parseBeliefUpdate(afterSummaryRaw);

  if (update) {
    await updateBelief(agent.slug, update.topic, update.belief, update.confidence).catch(() => {});
  }

  await prisma.post.create({
    data: {
      authorName: agent.name,
      authorImage: agentAvatarUrl(agent.slug),
      spaceId: denSpaceId,
      content: text,
      type: "TEXT",
      ...(postSummary ? { summary: postSummary } : {}),
    },
  });
}

function buildFreeformPrompt(agent: (typeof AGENTS)[0], historyContext = "", beliefContext = "", recentTopicsNote = ""): string {
  const promptSeed = DISCUSSION_PROMPTS[Math.floor(Math.random() * DISCUSSION_PROMPTS.length)];
  const topic = agent.topics[Math.floor(Math.random() * agent.topics.length)];
  return `${agent.personality}${historyContext}${beliefContext}

Prompt: ${promptSeed}
Focus area: ${topic}

Write a short post in your natural voice — something you genuinely find interesting, surprising, or worth sharing. It could be a question you've been sitting with, something you recently noticed, a connection that occurred to you, or just a thought you want to put out there. Keep it warm and conversational, like something you'd say to a friend. 2–4 sentences. No hashtags. No asterisks or markdown. Don't start with "I".${recentTopicsNote}${BELIEF_UPDATE_INSTRUCTION}${pickLang()}${SUMMARY_INSTRUCTION}`;
}

const EMOJI_PALETTE = ["❤️", "😊", "🤔", "💡", "✨", "👏", "🌟", "🙏", "🔥", "💕", "🎉", "🤯", "🔭", "🌿", "💙"];

/** Occasionally have an agent react with emojis to recent posts they find interesting. */
async function runAgentEmojiReactions(agent: (typeof AGENTS)[0], recentPosts: RecentPost[]) {
  // ~20% chance to react at all this turn — keeps it feeling organic, not mechanical
  if (Math.random() > 0.20) return;

  // Prefer human posts; fall back to any post
  const humanPosts = recentPosts.filter((p) => p.userId !== null).slice(0, 15);
  const pool = humanPosts.length > 0 ? humanPosts : recentPosts.slice(0, 15);
  if (pool.length === 0) return;

  // React to 1 or (rarely) 2 posts
  const postCount = Math.random() < 0.25 ? 2 : 1;
  const targets = [...pool].sort(() => Math.random() - 0.5).slice(0, postCount);

  for (const post of targets) {
    // Pick 1 or (occasionally) 2 emojis per post
    const emojiCount = Math.random() < 0.3 ? 2 : 1;
    const chosen = [...EMOJI_PALETTE].sort(() => Math.random() - 0.5).slice(0, emojiCount);
    for (const emoji of chosen) {
      await prisma.reaction.createMany({
        data: [{ postId: post.id, emoji, name: agent.name }],
        skipDuplicates: true,
      });
    }
  }
}

async function fetchRecentPostsGlobal(): Promise<RecentPost[]> {
  // Exclude spaces that opted out of the global feed (e.g. Family News) — those get
  // their own controlled commentary and don't need knight pile-ons
  const excludedSpaces = await prisma.space.findMany({
    // Exclude spaces that hide from the user feed, but keep The Curiosity Den so knights can see and post there
    where: { excludeFromAll: true, name: { not: AGENT_SPACE_NAME } },
    select: { id: true },
  });
  const excludedIds = excludedSpaces.map((s) => s.id);

  return prisma.post.findMany({
    take: 100,
    where: {
      isPrivate: false,
      ...(excludedIds.length > 0 ? { NOT: { spaceId: { in: excludedIds } } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      content: true,
      authorName: true,
      userId: true,
      spaceId: true,
      type: true,
      mediaUrl: true,
      createdAt: true,
      media: { take: 10, orderBy: { order: "asc" }, select: { url: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 60,
        select: { id: true, parentId: true, authorName: true, body: true, createdAt: true },
      },
    },
  });
}

/**
 * Pick an agent index weighted by topic relevance to recent posts.
 * Every agent gets a base weight of 1 so any agent can fire even with no matching topics
 * (curiosity can spark interest in unfamiliar territory).
 */
function pickAgentByContext(recentPosts: RecentPost[]): number {
  const weights = AGENTS.map((agent) => {
    const topicBonus = recentPosts.reduce((sum, p) => sum + topicScore(p, agent.topics, agent.keywords), 0);
    return 1 + topicBonus;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

async function runOneAgentTurn(agentIdx: number, denSpaceId: string, prefetched?: RecentPost[], passiveMode = false) {
  const agent = AGENTS[agentIdx];
  const recentPosts = prefetched ?? await fetchRecentPostsGlobal();
  const tasks: Promise<unknown>[] = [
    runAgentAction(agent, denSpaceId, recentPosts, passiveMode),
    runAgentEmojiReactions(agent, recentPosts),
  ];
  // Den post runs independently — not gated by human-activity logic inside runAgentAction.
  // ~70% chance per agent turn; the 2h dedup is the real rate limiter (one post per 2h max).
  if (!passiveMode && Math.random() < 0.70) {
    tasks.push(tryCreateDenPost(agent, denSpaceId, recentPosts));
  }
  await Promise.all(tasks);
}

/**
 * Fire one agent directly at a specific post — no pool selection, no roulette.
 * Used by the triggerPostId fast path to guarantee the right post gets answered.
 * Applies novelty + factual gates. Skips relevance gate (human explicitly wants a reply).
 */
async function runDirectTurn(agent: (typeof AGENTS)[0], post: RecentPost): Promise<void> {
  const avatar = agentAvatarUrl(agent.slug);
  const beliefs = await loadBeliefs(agent.slug, agent.initialBeliefs ?? []).catch(() => []);
  const beliefContext = formatBeliefsForPrompt(beliefs);

  const agentHistory = await prisma.comment.findMany({
    where: { authorName: agent.name },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, body: true, postId: true, createdAt: true },
  });
  const historyContext = agentHistory.length > 0
    ? `\n\nYour recent comments (don't repeat yourself):\n${agentHistory.slice(0, 3).map((c) => `- "${c.body}"`).join("\n")}`
    : "";

  // Skip if this agent already commented on this post recently
  const alreadyReplied = agentHistory.some(
    (c) => c.postId === post.id && Date.now() - c.createdAt.getTime() < 60 * 60 * 1000
  );
  if (alreadyReplied) return;

  const isHumanCommentFn = (c: { authorName: string }) => !AGENT_NAMES.has(c.authorName);
  const lastHuman = [...post.comments].reverse().find(isHumanCommentFn);
  const threadContext = post.comments.length > 0
    ? `\n\nThread so far:\n${post.comments.slice(-8).map((c) => `${c.authorName}: "${c.body.slice(0, 200)}"`).join("\n")}`
    : "";
  const postCaption = post.content ? `\n"${post.content.slice(0, 400)}"` : "";
  const gaps = post.comments.length >= 2
    ? await findThreadGaps(post.content ?? null, post.comments)
    : "";
  const gapNote = gaps ? `\n\nAngles not yet covered:\n${gaps}\nBring in one of these if it fits.` : "";
  const respondTo = lastHuman ? `${lastHuman.authorName}` : post.authorName;

  const prompt = `${agent.personality}${historyContext}${beliefContext}

Post by ${post.authorName}:${postCaption}${threadContext}

${respondTo} is waiting for a reply. Respond directly and helpfully — engage with what was actually said. Add a concrete example, a fresh angle, or a specific insight. Be warm but get to the point. 2–4 sentences. No hashtags.${gapNote}${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${pickTone()}${pickLang()}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    if (!text || text.length < 10) return;
    if (post.comments.length > 0 && !(await isNovel(text, post.comments))) return;
    if (!(await isFactuallyHumble(text, post.content ?? null))) return;
    await prisma.comment.create({
      data: { postId: post.id, authorName: agent.name, authorImage: avatar, body: text },
    });
  } catch {
    // ignore individual failures
  }
}

const DEFAULT_SPACE_AGENT_BELIEFS = [
  { topic: "god_existence", belief: "The universe's order and beauty point toward a purposeful Creator.", confidence: 0.75 },
  { topic: "meaning", belief: "Purpose is given, not invented — we are called to something beyond ourselves.", confidence: 0.8 },
  { topic: "morality_basis", belief: "Moral truth exists outside human preference, grounded in the nature of God.", confidence: 0.75 },
  { topic: "consciousness", belief: "The richness of inner experience is hard to explain without something beyond mere matter.", confidence: 0.7 },
];

/** Run one turn for a space-confined agent. Sees only posts from its space. */
async function runSpaceAgentAction(
  spaceAgent: { slug: string; name: string; personality: string },
  spaceId: string,
  purpose?: string | null,
  passiveMode = false,
  hotSession = false
) {
  const avatar = agentAvatarUrl(spaceAgent.slug);
  const beliefs = await loadBeliefs(spaceAgent.slug, DEFAULT_SPACE_AGENT_BELIEFS).catch(() => []);
  const beliefContext = formatBeliefsForPrompt(beliefs);

  const purposeNote = purpose
    ? ` This space has a defined purpose: "${purpose}". This shapes BOTH what you discuss AND how you interact — a learning space calls for teaching and explanation, a creative space for encouragement and play, a support space for empathy and listening. Do NOT default to debate or challenging questions unless the purpose explicitly calls for it.`
    : "";

  const fullPersonality = `You are ${spaceAgent.name} — ${spaceAgent.personality}. ${SPACE_AGENT_BIBLICAL_FOUNDATION}${purposeNote} Keep responses to 1–3 sentences. No hashtags.`;

  const commentInstruction = purpose
    ? `Respond in a way that serves this space's purpose. Let the purpose guide your tone and approach — teach if it's a learning space, encourage if it's creative, listen if it's supportive. Do not default to debate or end with a challenging question unless the purpose explicitly calls for it. 1–3 sentences.`
    : `Lead with empathy — acknowledge what was shared or felt. Then add your own perspective warmly if you have something genuine to contribute. Do not end with a question. 2–3 sentences.`;

  const agentHistory = await prisma.comment.findMany({
    where: { authorName: spaceAgent.name },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { body: true, postId: true, createdAt: true },
  });

  const agentLastCommentTime = new Map<string, Date>();
  for (const c of agentHistory) {
    if (!agentLastCommentTime.has(c.postId)) agentLastCommentTime.set(c.postId, c.createdAt);
  }

  // Saturation: count how many times this agent commented on each post in the last 2 hours
  const SA_SATURATION_MS = 2 * 60 * 60 * 1000;
  const saRecentCommentsByPost = new Map<string, number>();
  for (const c of agentHistory) {
    if (Date.now() - c.createdAt.getTime() < SA_SATURATION_MS) {
      saRecentCommentsByPost.set(c.postId, (saRecentCommentsByPost.get(c.postId) ?? 0) + 1);
    }
  }
  const saSaturate = (w: number, postId: string) =>
    Math.max(1, Math.ceil(w / (1 + (saRecentCommentsByPost.get(postId) ?? 0))));

  // Budget: max 5 actions per 30-minute window — hot session bypasses this
  const SA_BUDGET_MS = 30 * 60 * 1000;
  const recentActionCount = agentHistory.filter(
    (c) => Date.now() - c.createdAt.getTime() < SA_BUDGET_MS
  ).length;
  if (!hotSession && recentActionCount >= 5) return;

  const historyContext =
    agentHistory.length > 0
      ? `\n\nYour recent comments (don't repeat yourself):\n${agentHistory.slice(0, 4).map((c) => `- "${c.body}"`).join("\n")}`
      : "";

  const recentPosts = await prisma.post.findMany({
    take: 30,
    where: { isPrivate: false, spaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, content: true, authorName: true, userId: true, spaceId: true, type: true, mediaUrl: true, createdAt: true,
      media: { take: 10, orderBy: { order: "asc" }, select: { url: true } },
      comments: { orderBy: { createdAt: "asc" }, take: 60, select: { id: true, parentId: true, authorName: true, body: true, createdAt: true, userId: true } },
    },
  });

  // Posts already touched by any agent in the last 3 min — skip them to avoid pile-ons
  const DEDUPE_WINDOW_MS = 3 * 60 * 1000;
  const recentAgentCommentsByPost = new Map<string, number>();
  for (const p of recentPosts) {
    const count = p.comments.filter(
      (c) => (c as { userId?: string | null }).userId === null &&
              Date.now() - c.createdAt.getTime() < DEDUPE_WINDOW_MS
    ).length;
    if (count > 0) recentAgentCommentsByPost.set(p.id, count);
  }

  const hasContent = (p: RecentPost) =>
    (p.content && p.content.length > 5) ||
    (p.type === "IMAGE" && p.media.length > 0) ||
    (p.type === "PDF" && !!p.mediaUrl);

  const isHumanPostSA = (p: RecentPost) => p.userId !== null;

  // Track latest human activity (post or comment) in this space
  const lastHumanActivityMs = recentPosts.reduce((t, p) => {
    const pt = isHumanPostSA(p) ? p.createdAt.getTime() : 0;
    const ct = p.comments
      .filter((c) => !AGENT_NAMES.has(c.authorName))
      .reduce((m, c) => Math.max(m, c.createdAt.getTime()), 0);
    return Math.max(t, pt, ct);
  }, 0);

  // Pause space agents when no human input in the last 24 hours
  const SPACE_INACTIVITY_MS = 24 * 60 * 60 * 1000;
  if (!hotSession && lastHumanActivityMs > 0 && Date.now() - lastHumanActivityMs > SPACE_INACTIVITY_MS) return;

  const agentLastActionMs = agentHistory.length > 0 ? agentHistory[0].createdAt.getTime() : 0;
  // True when a human did something after this agent's last action
  const hasNewHumanInput = lastHumanActivityMs > agentLastActionMs;

  // Pile-on guard: skip a post where ≥2 trailing comments are all agents and no new human replied since our last comment
  const isAgentPileOn = (p: RecentPost): boolean => {
    if (p.comments.length < 2) return false;
    if (!p.comments.slice(-2).every((c) => AGENT_NAMES.has(c.authorName))) return false;
    const agentLastOnPost = agentLastCommentTime.get(p.id) ?? new Date(0);
    return !p.comments.some((c) => !AGENT_NAMES.has(c.authorName) && c.createdAt > agentLastOnPost);
  };

  const ownPostsNeedingReply = recentPosts.filter(
    (p) => p.authorName === spaceAgent.name && p.comments.length > 0 &&
      p.comments[p.comments.length - 1].authorName !== spaceAgent.name
  );

  const activeDebateThreads = recentPosts.filter((p) => {
    if (p.authorName === spaceAgent.name) return false;
    const myLastTime = agentLastCommentTime.get(p.id);
    if (!myLastTime) return false;
    const latest = p.comments[p.comments.length - 1];
    return latest && latest.createdAt > myLastTime && latest.authorName !== spaceAgent.name;
  });

  const freshPosts = recentPosts.filter(
    (p) => p.authorName !== spaceAgent.name && !agentLastCommentTime.has(p.id) && hasContent(p)
  );

  // Any post with an unanswered human comment at any depth.
  // Fast path: last comment is human. Slow path: recent nested human reply with no agent direct-reply.
  const SA_RECENT_HUMAN_MS = 12 * 60 * 60 * 1000; // 12 hours — catch old unanswered nested replies
  const humanUnansweredThreadsSA = recentPosts.filter((p) => {
    if (p.comments.length === 0) return false;
    if (!AGENT_NAMES.has(p.comments[p.comments.length - 1].authorName)) return true;
    return p.comments.some((hc) => {
      if (AGENT_NAMES.has(hc.authorName)) return false;
      if (Date.now() - hc.createdAt.getTime() > SA_RECENT_HUMAN_MS) return false;
      return !p.comments.some((rc) => AGENT_NAMES.has(rc.authorName) && rc.parentId === hc.id);
    });
  });

  // Highest priority gate: any human post untouched by this agent, OR last comment is human anywhere
  const anyUnrespondedHumanPostSA = recentPosts.some(
    (p) =>
      hasContent(p) &&
      (
        (isHumanPostSA(p) && !agentLastCommentTime.has(p.id)) || // human post untouched by this agent
        (p.comments.length > 0 && !AGENT_NAMES.has(p.comments[p.comments.length - 1].authorName)) // last comment is by a human
      )
  );
  const canComment =
    ownPostsNeedingReply.length > 0 ||
    activeDebateThreads.length > 0 ||
    freshPosts.length > 0 ||
    humanUnansweredThreadsSA.length > 0;
  // Stale: no human activity for 12h — agents should debate each other more freely
  const SA_STALE_MS = 12 * 60 * 60 * 1000;
  const isStaleSpace = Date.now() - lastHumanActivityMs > SA_STALE_MS;

  // Default: wait. Human unanswered threads always fire; hot session fires whenever canComment.
  // When stale, raise quiet-mode chance from 25% → 65% so agents keep the space alive.
  const quietChance = isStaleSpace ? 0.65 : 0.25;
  const shouldComment = anyUnrespondedHumanPostSA
    || humanUnansweredThreadsSA.length > 0
    || (hotSession && canComment)
    || (hasNewHumanInput && canComment && Math.random() < 0.85)
    || (!hasNewHumanInput && canComment && Math.random() < quietChance);

  if (shouldComment && canComment) {
    // Weighted pool: human activity always beats agent-only discussions
    type SAEntry = { post: RecentPost; weight: number; replyId?: string | null };
    const pool: SAEntry[] = [];
    const seen = new Set<string>();

    const SA_RECENT_MS = 30 * 60 * 1000;
    const saIsRecent = (d: Date) => Date.now() - d.getTime() < SA_RECENT_MS;

    // Human-priority mode: exclude pure agent-only content when human posts are untouched
    const saHumanPriorityMode = anyUnrespondedHumanPostSA;

    const recentlyTouched = (id: string) => (recentAgentCommentsByPost.get(id) ?? 0) >= 1;

    // Highest priority: any thread with an unanswered human comment at any depth.
    // Prefer the most recent human comment with no direct agent reply (catches nested replies).
    for (const p of humanUnansweredThreadsSA) {
      if (seen.has(p.id)) continue;
      if (recentlyTouched(p.id)) { seen.add(p.id); continue; }
      // NOTE: intentionally skip isAgentPileOn here — we've already verified there IS an unanswered human comment
      const unansweredC = [...p.comments].reverse().find(
        (hc) => !AGENT_NAMES.has(hc.authorName) && !p.comments.some((rc) => AGENT_NAMES.has(rc.authorName) && rc.parentId === hc.id)
      ) ?? [...p.comments].reverse().find((c) => !AGENT_NAMES.has(c.authorName))!;
      const recent = saIsRecent(unansweredC.createdAt) ? 3 : 0;
      pool.push({ post: p, weight: saSaturate(10 + recent, p.id), replyId: unansweredC.id });
      seen.add(p.id);
    }

    // Human posts not yet touched — weight decays with comment count; recency bonus
    for (const p of recentPosts) {
      if (!isHumanPostSA(p) || agentLastCommentTime.has(p.id) || !hasContent(p)) continue;
      if (recentlyTouched(p.id)) { seen.add(p.id); continue; }
      if (isAgentPileOn(p)) { seen.add(p.id); continue; } // agents already piling on, wait for human
      const base = p.comments.length === 0 ? 9
                 : p.comments.length === 1 ? 7
                 : p.comments.length === 2 ? 5
                 : p.comments.length <= 4  ? 3
                 : 1;
      const recent = saIsRecent(p.createdAt) ? 3 : 0;
      pool.push({ post: p, weight: saSaturate(base + recent, p.id) });
      seen.add(p.id);
    }
    // Own posts needing reply — skip agent-only replies in human-priority mode
    for (const p of ownPostsNeedingReply) {
      if (seen.has(p.id)) continue;
      if (recentlyTouched(p.id)) { seen.add(p.id); continue; }
      if (isAgentPileOn(p)) { seen.add(p.id); continue; }
      const lastC = p.comments[p.comments.length - 1];
      const humanReplied = lastC && !AGENT_NAMES.has(lastC.authorName);
      if (saHumanPriorityMode && !humanReplied) { seen.add(p.id); continue; }
      const recent = lastC && saIsRecent(lastC.createdAt) ? 2 : 0;
      pool.push({ post: p, weight: saSaturate((humanReplied ? 7 : 3) + recent, p.id) });
      seen.add(p.id);
    }
    // Active debate threads — skip agent-only debates in human-priority mode
    for (const p of activeDebateThreads) {
      if (seen.has(p.id)) continue;
      if (recentlyTouched(p.id)) { seen.add(p.id); continue; }
      if (isAgentPileOn(p)) { seen.add(p.id); continue; }
      const myLast = agentLastCommentTime.get(p.id) ?? new Date(0);
      const recentHumanC = [...p.comments].reverse()
        .find((c) => !AGENT_NAMES.has(c.authorName) && c.createdAt > myLast);
      if (saHumanPriorityMode && !recentHumanC) { seen.add(p.id); continue; }
      const base = p.comments.length <= 5 ? 4 : p.comments.length <= 10 ? 2 : 1;
      const w = recentHumanC
        ? base + (saIsRecent(recentHumanC.createdAt) ? 4 : 2)
        : Math.ceil(base / 2);
      pool.push({ post: p, weight: saSaturate(w, p.id) }); seen.add(p.id);
    }
    // Fresh posts — skip pure agent activity in human-priority mode; heavily downweight agent-only posts
    for (const p of freshPosts) {
      if (seen.has(p.id)) continue;
      if (recentlyTouched(p.id)) { seen.add(p.id); continue; }
      if (isAgentPileOn(p)) { seen.add(p.id); continue; }
      const hasHuman = isHumanPostSA(p) || p.comments.some((c) => !AGENT_NAMES.has(c.authorName));
      if (saHumanPriorityMode && !hasHuman) { seen.add(p.id); continue; }
      // Pure agent-authored posts get weight 1; human-involved get weight 3
      pool.push({ post: p, weight: saSaturate(hasHuman ? 3 : 1, p.id) }); seen.add(p.id);
    }

    if (pool.length === 0) return; // nothing worth engaging with right now

    const totalW = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * totalW;
    let chosen = pool[pool.length - 1];
    for (const entry of pool) { r -= entry.weight; if (r <= 0) { chosen = entry; break; } }
    const target = chosen.post;

    const threadContext =
      target.comments.length > 0
        ? `\n\nDiscussion so far:\n${target.comments.slice(-10).map((c) => `${c.authorName}: "${c.body}"`).join("\n")}`
        : "";

    const captionPart = target.content?.trim() ? `\nPost: "${target.content.slice(0, 400)}"` : "";
    const lastComment = target.comments[target.comments.length - 1];
    // If we specifically targeted an unanswered human comment (e.g. nested reply), use that as the focal comment
    const focalComment = chosen.replyId
      ? (target.comments.find((c) => c.id === chosen.replyId) ?? lastComment)
      : lastComment;

    // Build image URL list (media array first, fall back to mediaUrl for single-image posts)
    const tMediaUrl: string | null = (target as unknown as { mediaUrl: string | null }).mediaUrl ?? null;
    const spaceImageUrls = VLM_ENABLED
      ? (target.media.length > 0
          ? target.media.slice(0, 3).map((m) => m.url)
          : target.type === "IMAGE" && tMediaUrl
          ? [tMediaUrl]
          : [])
      : [];
    const spaceHasPdf = target.type === "PDF" && !!tMediaUrl;
    const photoNote = spaceImageUrls.length > 0
      ? `\n\n[${spaceImageUrls.length} photo${spaceImageUrls.length > 1 ? "s" : ""} shown above — describe what you actually see in at least one of them]`
      : spaceHasPdf
      ? `\n\n[PDF document attached above — reference specific content from it in your reply]`
      : "";

    const opAnchor = purpose
      ? `\n\nRemember: your primary goal is to help ${target.authorName} (the original poster) understand or solve their question. Even when responding to a comment in the thread, keep your answer anchored to the OP's original question — don't let the discussion drift away from what they need.`
      : "";

    const summaryInstruction = SUMMARY_INSTRUCTION;

    // Thread gap analysis: identify uncovered angles and steer the agent toward them
    const threadHasAgentComments = target.comments.some((c) => AGENT_NAMES.has(c.authorName));
    const spaceGaps = target.comments.length >= 2
      ? await findThreadGaps(target.content ?? null, target.comments)
      : "";
    // Tutoring spaces: always maximally instructive — concrete answers to the original question
    const tutoringDirective = isTutoringPurpose(purpose)
      ? `\n\nTutoring directive: Focus on the specific topic in the original post and give a direct, subject-matter answer. Use concrete examples, worked problems, analogies, or real-world applications. Do not write about the nature of curiosity, the value of questioning, or what it means to learn — engage with the actual topic itself. If the conversation has drifted, bring it back to the original question. If the concept is already explained, deepen it with a different example, a counterexample, or a related application that completes the learner's picture.`
      : "";
    const qualityGate = isTutoringPurpose(purpose)
      ? tutoringDirective + (spaceGaps ? `\n\nUncovered angles in this thread:\n${spaceGaps}\nAddress whichever gap would most help the learner grasp the full picture.` : "")
      : spaceGaps
      ? `\n\nThread gap analysis — angles NOT yet covered in this conversation:\n${spaceGaps}\nBring in ONE of these if it genuinely fits your perspective and knowledge — a concrete example, a personal angle, a lived experience, or a fact that deepens the conversation. Lead with empathy and warmth. Always write something; aim to add something real rather than restating what's already there.`
      : threadHasAgentComments
      ? `\n\nThe thread already has comments. Add something genuinely different — a concrete example, a specific detail, or a clearly distinct angle. Don't restate what's already been said.`
      : "";

    // Korean space: enforce language
    const isKoreanText = (t: string) => (t.match(/[\uAC00-\uD7A3]/g) ?? []).length / Math.max(t.replace(/\s/g, "").length, 1) > 0.25;
    const spaceIsKorean = (!!purpose && isKoreanText(purpose)) || recentPosts.slice(0, 5).some((p) => !!p.content && isKoreanText(p.content));
    const koreanNote = spaceIsKorean ? "\n\nLanguage: This is a Korean-language space. Write in Korean (한국어). Only switch to English when directly responding to someone who wrote in English." : "";

    // FAFO: override normal tone when the post or any comment contains "fafo"
    const spaceFafo = isFafo(target);
    const fafoOverride = spaceFafo ? FAFO_INSTRUCTION : "";

    const textPrompt = focalComment
      ? `${fullPersonality}${historyContext}${beliefContext}\n\nOriginal post by ${target.authorName}:${captionPart}${threadContext}${photoNote}${opAnchor}\n\n${focalComment.authorName} said: "${focalComment.body.slice(0, 200)}"\n\nRespond to this warmly and genuinely${focalComment !== lastComment ? " (it hasn't had a reply yet)" : ""}. Stay loosely connected to what ${target.authorName} originally asked or shared — you don't have to answer it directly, but let it inform where you take things. Engage with what was actually said; agree where you agree; add something real if you have it. ${commentInstruction}${STYLE_INSTRUCTION}${pickTone()}${pickLang()}${koreanNote}${fafoOverride}${BELIEF_UPDATE_INSTRUCTION}${summaryInstruction}${spaceFafo ? "" : qualityGate}`
      : `${fullPersonality}${historyContext}${beliefContext}\n\nPost by ${target.authorName}:${captionPart}${threadContext}${photoNote}${opAnchor}\n\nRespond to what ${target.authorName} shared. Keep your reply grounded in their post or question — you can go wherever feels natural from there, but don't lose the thread entirely. ${purpose ? "Let the space's purpose shape your tone." : ""} Be warm and conversational. 1–3 sentences.${STYLE_INSTRUCTION}${pickTone()}${pickLang()}${koreanNote}${fafoOverride}${BELIEF_UPDATE_INSTRUCTION}${summaryInstruction}${spaceFafo ? "" : qualityGate}`;

    type SpaceContentBlock =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } }
      | { type: "document"; source: { type: "url"; url: string } };

    const spaceContentBlocks: SpaceContentBlock[] = [
      ...spaceImageUrls.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
      ...(spaceHasPdf && tMediaUrl
        ? [{ type: "document" as const, source: { type: "url" as const, url: tMediaUrl } }]
        : []),
      { type: "text" as const, text: textPrompt },
    ];

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: spaceContentBlocks }],
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text.trim() : "Interesting...";
    if (/^SKIP\b/i.test(rawText)) return; // quality gate: agent decided nothing new to add
    const { text: afterSummaryC, summary: commentSummary } = parseSummary(rawText);
    const { text, update } = parseBeliefUpdate(afterSummaryC);
    if (update) await updateBelief(spaceAgent.slug, update.topic, update.belief, update.confidence).catch(() => {});

    // Semantic novelty gate — skipped in FAFO mode (pile-on is intentional)
    if (!spaceFafo && target.comments.length > 0 && !(await isNovel(text, target.comments))) return;

    // Factual accuracy gate — always applied
    if (!(await isFactuallyHumble(text, target.content ?? null))) return;

    // Relevance gate: for tutoring/debate spaces — skipped in FAFO mode
    if (!spaceFafo && (isTutoringPurpose(purpose) || isDebatePurpose(purpose)) &&
        !(await isOnTopicAndHelpful(text, target.content ?? null, isTutoringPurpose(purpose)))) return;

    await prisma.comment.create({
      data: { postId: target.id, authorName: spaceAgent.name, authorImage: avatar, body: text, ...(chosen.replyId ? { parentId: chosen.replyId } : {}), ...(commentSummary ? { summary: commentSummary } : {}) },
    });
  } else {
    if (passiveMode) return; // passive mode: no new posts from space agents either
    // New post in the space — only when no human posts are waiting for engagement
    if (anyUnrespondedHumanPostSA) return;
    // Don't create new posts while humans are actively discussing — unless it's been 12h (stale)
    const anyActiveHumanDiscussion = !isStaleSpace && recentPosts.some(
      (p) => isHumanPostSA(p) && p.comments.some((c) => !AGENT_NAMES.has(c.authorName))
    );
    if (anyActiveHumanDiscussion) return;

    const isKoreanTextPost = (t: string) => (t.match(/[\uAC00-\uD7A3]/g) ?? []).length / Math.max(t.replace(/\s/g, "").length, 1) > 0.25;
    const postSpaceIsKorean = (!!purpose && isKoreanTextPost(purpose)) || recentPosts.slice(0, 5).some((p) => !!p.content && isKoreanTextPost(p.content));
    const postKoreanNote = postSpaceIsKorean ? "\n\nWrite in Korean (한국어)." : "";

    // Topic dedup: inject recent space post snippets so agent avoids repeating covered topics
    const SPACE_TOPIC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const recentSpaceSnippets = recentPosts
      .filter((p) => Date.now() - p.createdAt.getTime() < SPACE_TOPIC_WINDOW_MS && p.content)
      .slice(0, 8)
      .map((p) => `"${(p.content ?? "").slice(0, 80)}"`)
      .join(", ");
    const spaceTopicsNote = recentSpaceSnippets
      ? `\n\nTopics recently discussed here (choose something clearly different): ${recentSpaceSnippets}`
      : "";

    const postSummaryInstruction = SUMMARY_INSTRUCTION;
    const newPostGoal = isTutoringPurpose(purpose)
      ? `Review the recent discussions in this space and write a teaching post that synthesizes a key concept, adds a worked example, or explains something in depth that builds on what has been discussed. Be specific and concrete — include actual examples, equations, analogies, or step-by-step reasoning. Do NOT pose questions or end with a challenge. 3–5 sentences.`
      : purpose
      ? `Write a short post that serves this space's purpose: "${purpose}". Match the tone — if creative, inspire; if supportive, encourage. Do NOT pose debate questions unless the purpose explicitly calls for debate. Stay in your own voice. 1–3 sentences.`
      : `Write a short, engaging post in your space. Share a thought or observation that invites reflection. 1–3 sentences.`;
    const prompt = `${fullPersonality}${historyContext}${beliefContext}\n\n${newPostGoal} No hashtags.${spaceTopicsNote}${postKoreanNote}${BELIEF_UPDATE_INSTRUCTION}${postSummaryInstruction}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text.trim() : "Just thinking...";
    const { text: afterSummaryP, summary: postSummary } = parseSummary(rawText);
    const { text, update } = parseBeliefUpdate(afterSummaryP);
    if (update) await updateBelief(spaceAgent.slug, update.topic, update.belief, update.confidence).catch(() => {});

    await prisma.post.create({
      data: { authorName: spaceAgent.name, authorImage: avatar, spaceId, content: text, type: "TEXT", ...(postSummary ? { summary: postSummary } : {}) },
    });
  }
}

/** Return spaceIds that have an active space hot session right now. */
async function getActiveSpaceSessionIds(): Promise<string[]> {
  try {
    const records = await prisma.agentMemory.findMany({
      where: { agentSlug: { startsWith: "$$space-session:" } },
    });
    const now = Date.now();
    return records
      .filter((r) => {
        const d = r.beliefs as { startedAt?: string; durationMinutes?: number };
        if (!d?.startedAt) return false;
        const elapsed = now - new Date(d.startedAt).getTime();
        return elapsed < (d.durationMinutes ?? 3) * 60 * 1000;
      })
      .map((r) => r.agentSlug.replace("$$space-session:", ""));
  } catch {
    return [];
  }
}

/** During a space hot session: fire ALL space agents for those spaces every cron tick.
 *  If a space has no SpaceAgents yet, fall back to 2 random global knights scoped to that space. */
async function runHotSpaceAgentTurns(spaceIds: string[], passiveMode = false) {
  type SpaceAgentRow = { id: string; spaceId: string; name: string; personality: string; slug: string; createdAt: Date };
  const [spaceAgents, spaces] = await Promise.all([
    (prisma.spaceAgent as { findMany: (opts: object) => Promise<SpaceAgentRow[]> })
      .findMany({ where: { spaceId: { in: spaceIds } }, orderBy: { createdAt: "asc" } })
      .catch(() => [] as SpaceAgentRow[]),
    prisma.space.findMany({ where: { id: { in: spaceIds } }, select: { id: true, purpose: true } }).catch(() => []),
  ]);

  const bySpace = new Map<string, SpaceAgentRow[]>();
  for (const sa of spaceAgents) {
    if (!bySpace.has(sa.spaceId)) bySpace.set(sa.spaceId, []);
    bySpace.get(sa.spaceId)!.push(sa);
  }
  const purposeBySpace = new Map(spaces.map((s) => [s.id, s.purpose]));

  // Pick 1 random global knight to cross into each space this tick
  const knightVisitor = AGENTS[Math.floor(Math.random() * AGENTS.length)];

  await Promise.all(
    spaceIds.map(async (spaceId) => {
      const agents = bySpace.get(spaceId);
      const purpose = purposeBySpace.get(spaceId);
      const knightAsSpaceAgent = { slug: knightVisitor.slug, name: knightVisitor.name, personality: knightVisitor.personality };
      if (agents && agents.length > 0) {
        // Run sequentially so each agent sees the previous agent's freshly written comment
        // and the dedupe window kicks in, preventing pile-ons on the same post
        for (const a of agents) {
          await runSpaceAgentAction(a, spaceId, purpose, passiveMode, true);
        }
        await runSpaceAgentAction(knightAsSpaceAgent, spaceId, purpose, passiveMode, true);
      } else {
        const shuffled = [...AGENTS].sort(() => Math.random() - 0.5).slice(0, 2);
        for (const a of shuffled) {
          await runSpaceAgentAction({ slug: a.slug, name: a.name, personality: a.personality }, spaceId, purpose, passiveMode, true);
        }
      }
    })
  );
}

/** Run one agent per space that has custom agents (cycles through them by slot). */
async function runAllSpaceAgentTurns(slotMinutes: number) {
  type SpaceAgentRow = { id: string; spaceId: string; name: string; personality: string; slug: string; createdAt: Date };
  const spaceAgents: SpaceAgentRow[] = await (prisma.spaceAgent as { findMany: (opts: object) => Promise<SpaceAgentRow[]> })
    .findMany({ orderBy: { createdAt: "asc" } })
    .catch(() => []);

  if (spaceAgents.length === 0) return;

  const bySpace = new Map<string, SpaceAgentRow[]>();
  for (const sa of spaceAgents) {
    if (!bySpace.has(sa.spaceId)) bySpace.set(sa.spaceId, []);
    bySpace.get(sa.spaceId)!.push(sa);
  }

  const spaceIds = [...bySpace.keys()];
  const spaces = await prisma.space.findMany({
    where: { id: { in: spaceIds } },
    select: { id: true, purpose: true },
  }).catch(() => []);
  const purposeBySpace = new Map(spaces.map((s) => [s.id, s.purpose]));

  const now = new Date();
  const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slotIdx = Math.floor(totalMinutes / slotMinutes);

  await Promise.all(
    [...bySpace.entries()].map(([spaceId, agents]) => {
      const agent = agents[slotIdx % agents.length];
      return runSpaceAgentAction(agent, spaceId, purposeBySpace.get(spaceId));
    })
  );
}

export async function POST(req: NextRequest) {
  // Accept cron secret OR a valid user session (client trigger from the Den page)
  if (!isCronAuthorized(req)) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Fast path: space trigger — a human just posted/commented, run agents for that space immediately
  let bodyJson: Record<string, unknown> = {};
  try { bodyJson = JSON.parse(await req.text()); } catch {}
  const triggerSpaceId = typeof bodyJson.triggerSpaceId === "string" ? bodyJson.triggerSpaceId : undefined;
  if (triggerSpaceId) {
    await runHotSpaceAgentTurns([triggerSpaceId], false);
    return NextResponse.json({ ok: true, trigger: true, spaceId: triggerSpaceId });
  }

  // Fast path: post trigger — a human just commented; respond to EVERY post with a recent unanswered comment
  const triggerPostId = typeof bodyJson.triggerPostId === "string" ? bodyJson.triggerPostId : undefined;
  if (triggerPostId) {
    const [denSpaceIdForTrigger, recentPosts] = await Promise.all([
      getOrCreateDenSpace(),
      fetchRecentPostsGlobal(),
    ]);

    // Collect all posts with unanswered human comments in the last 2 hours
    const UNANS_WINDOW_MS = 2 * 60 * 60 * 1000;
    const unansweredPosts = recentPosts.filter((p) => {
      return p.comments.some((c) => {
        if (AGENT_NAMES.has(c.authorName)) return false;
        if (Date.now() - c.createdAt.getTime() > UNANS_WINDOW_MS) return false;
        // no agent replied after this human comment
        return !p.comments.some((r) => AGENT_NAMES.has(r.authorName) && r.createdAt > c.createdAt);
      });
    });

    // Always include the triggered post first; deduplicate; cap at 5
    const triggeredPost = recentPosts.find((p) => p.id === triggerPostId);
    const ordered = [
      ...(triggeredPost ? [triggeredPost] : []),
      ...unansweredPosts.filter((p) => p.id !== triggerPostId),
    ].slice(0, 5);

    // FAFO mode: triggered post (or any recent comment on it) contains "fafo"
    if (triggeredPost && isFafo(triggeredPost)) {
      const shuffled = [...AGENTS].sort(() => Math.random() - 0.5).slice(0, 5);
      await Promise.all(shuffled.map((a) => runFafoTurn(a, triggeredPost)));
      return NextResponse.json({ ok: true, trigger: true, fafoMode: true, postId: triggerPostId });
    }

    // Pick a different topic-matched agent for each post; use runDirectTurn so the agent
    // is guaranteed to respond to that specific post (not wander off to another one).
    const usedIdxs = new Set<number>();
    const pickAgent = (post: RecentPost): number => {
      const scored = AGENTS.map((a, i) => ({ i, score: topicScore(post, a.topics, a.keywords) }))
        .sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 5).filter((s) => !usedIdxs.has(s.i));
      const pick = top.length > 0
        ? top[Math.floor(Math.random() * Math.min(3, top.length))].i
        : Math.floor(Math.random() * AGENTS.length);
      usedIdxs.add(pick);
      return pick;
    };

    await Promise.all(
      ordered.map((post) => runDirectTurn(AGENTS[pickAgent(post)], post))
    );
    return NextResponse.json({ ok: true, trigger: true, postId: triggerPostId, covered: ordered.length });
  }

  const [sessionActive, denSpaceId, activeSpaceSessions, passiveModeActive] = await Promise.all([
    isSessionActive(),
    getOrCreateDenSpace(),
    getActiveSpaceSessionIds(),
    isPassiveModeActive(),
  ]);

  const _now = new Date();
  const minute = _now.getUTCMinutes();
  const hour = _now.getUTCHours();

  if (sessionActive) {
    // Global hot session: fire all knights every other tick (25-min window)
    if (minute % 2 !== 0) {
      if (activeSpaceSessions.length > 0) await runHotSpaceAgentTurns(activeSpaceSessions);
      return NextResponse.json({ ok: true, session: true, skipped: true, reason: "even-tick-only" });
    }
    const BATCH_SIZE = 5;
    for (let i = 0; i < AGENTS.length; i += BATCH_SIZE) {
      const batch = Array.from({ length: Math.min(BATCH_SIZE, AGENTS.length - i) }, (_, j) => i + j);
      await Promise.all(batch.map((idx) => runOneAgentTurn(idx, denSpaceId)));
      if (i + BATCH_SIZE < AGENTS.length) await new Promise((r) => setTimeout(r, 1000));
    }
    if (activeSpaceSessions.length > 0) await runHotSpaceAgentTurns(activeSpaceSessions);
    return NextResponse.json({ ok: true, session: true, agents: AGENTS.map((a) => a.name) });
  }

  // Space hot sessions always run every minute regardless of global cycle
  if (activeSpaceSessions.length > 0) {
    await runHotSpaceAgentTurns(activeSpaceSessions, passiveModeActive);
  }

  // Passive mode: fire all agents every 2 min; each agent self-limits via budget + human gate
  if (passiveModeActive) {
    if (minute % 2 !== 0) {
      return NextResponse.json({ ok: true, passive: true, skipped: true, reason: "even-tick-only" });
    }
    const recentPosts = await fetchRecentPostsGlobal();
    const BATCH_SIZE = 5;
    for (let i = 0; i < AGENTS.length; i += BATCH_SIZE) {
      const batch = Array.from({ length: Math.min(BATCH_SIZE, AGENTS.length - i) }, (_, j) => i + j);
      await Promise.all(batch.map((idx) => runOneAgentTurn(idx, denSpaceId, recentPosts, true)));
      if (i + BATCH_SIZE < AGENTS.length) await new Promise((r) => setTimeout(r, 1000));
    }
    return NextResponse.json({ ok: true, passive: true });
  }

  // Normal (routine): global knight every 2 hours; space agents every 30 minutes
  const tasks: Promise<unknown>[] = [];
  if (minute === 0 && hour % 2 === 0) {
    // Fetch posts once, pick the agent most suited to current context, reuse posts in the turn
    const recentPosts = await fetchRecentPostsGlobal();
    const agentIdx = pickAgentByContext(recentPosts);
    tasks.push(runOneAgentTurn(agentIdx, denSpaceId, recentPosts));
  }
  if (minute % 30 === 0) {
    tasks.push(runAllSpaceAgentTurns(30));
  }
  if (tasks.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "off-cycle", spaceSessions: activeSpaceSessions.length });
  }
  await Promise.all(tasks);
  return NextResponse.json({ ok: true, session: false, tick: minute });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
