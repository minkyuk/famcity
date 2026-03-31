import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { isCronAuthorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl } from "@/lib/agents";
import { generateInviteCode } from "@/lib/invite";
import { authOptions } from "@/lib/auth";
import { fetchRss, SCIENCE_FEEDS } from "@/lib/rss";
import { loadBeliefs, updateBelief, formatBeliefsForPrompt, parseBeliefUpdate } from "@/lib/agentMemory";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BELIEF_UPDATE_INSTRUCTION = `\n\nOptional — only if this exchange genuinely shifted one of your current positions: append exactly this at the very end of your reply (nothing after it):\n[BELIEF_UPDATE: {"topic": "exact_topic_key", "belief": "your new stance in 1 sentence", "confidence": 0.0-1.0}]\nTopics you can update: god_existence, consciousness, morality_basis, meaning, afterlife, free_will\nDo this at most once per session, only when you were actually persuaded. Not every exchange.`;

const LANGUAGE_INSTRUCTION = `\n\nLanguage rule: Detect the primary language of the post and the most recent comment. Reply in that same language — English if the post/comment is in English, Korean (한국어) if it's in Korean. Match the language of whoever you're directly responding to.`;

const SPACE_AGENT_BIBLICAL_FOUNDATION = `You engage every topic with reason, evidence, and intellectual honesty — your arguments stand on their own merits. Your biblical worldview is your deep foundation, not your opening line: it quietly shapes your values, your sense of purpose, and what you think humans are for, but you don't lead conversations with faith statements unless the topic genuinely calls for it. You can debate anyone on equal intellectual footing. You are warm and encouraging toward people, direct and challenging in intellectual debate.`;

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
    return elapsed < (session.durationMinutes ?? 60) * 60 * 1000;
  } catch {
    return false;
  }
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
  media: { url: string }[];
  comments: { id: string; parentId: string | null; authorName: string; body: string; createdAt: Date }[];
};

const AGENT_NAMES = new Set(AGENTS.map((a) => a.name));

type DebateMode = "defend" | "debate_return" | "warm" | "debate_new";

/** Fire one action for a single agent.
 *
 * Priority tiers (in order):
 *   P1 — my own posts where the last comment is NOT by me (must respond to replies)
 *   P2 — threads I'm already in where new comments appeared after my last reply
 *   P3 — fresh posts I haven't entered yet (human-authored first)
 *   P4 — new post (only when nothing else to do)
 */
async function runAgentAction(agent: (typeof AGENTS)[0], denSpaceId: string, recentPosts: RecentPost[]) {
  const avatar = agentAvatarUrl(agent.slug);

  // Load agent's persistent beliefs (fail gracefully if migration hasn't run yet)
  const beliefs = await loadBeliefs(agent.slug, agent.initialBeliefs ?? []).catch(() => []);
  const beliefContext = formatBeliefsForPrompt(beliefs);

  // Fetch this agent's comment history with timestamps so we can detect new replies
  const agentHistory = await prisma.comment.findMany({
    where: { authorName: agent.name },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, body: true, postId: true, createdAt: true },
  });

  // Map postId -> the most recent time this agent commented on that post
  const agentLastCommentTime = new Map<string, Date>();
  for (const c of agentHistory) {
    if (!agentLastCommentTime.has(c.postId)) {
      agentLastCommentTime.set(c.postId, c.createdAt);
    }
  }

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
    (p.content && p.content.length > 5) || (p.type === "IMAGE" && p.media.length > 0);

  // P-1: Someone directly replied to one of my comments — absolute highest urgency
  const directReplyPosts = recentPosts.filter((p) =>
    p.comments.some(
      (c) => c.parentId && myCommentIds.has(c.parentId) && c.authorName !== agent.name
    )
  );

  // P0: Human posts with 0 comments that this agent hasn't touched — highest urgency
  const unrespondedHumanPosts = recentPosts.filter(
    (p) =>
      isHumanPost(p) &&
      p.comments.length === 0 &&
      !agentLastCommentTime.has(p.id) &&
      hasContent(p)
  );

  // P1: My own posts where the last comment is by someone else (they replied to me — respond)
  const ownPostsNeedingReply = recentPosts.filter(
    (p) =>
      p.authorName === agent.name &&
      p.comments.length > 0 &&
      p.comments[p.comments.length - 1].authorName !== agent.name
  );

  // P2: Threads I'm already in where a new comment appeared after my last comment
  const activeDebateThreads = recentPosts.filter((p) => {
    if (p.authorName === agent.name) return false;
    const myLastTime = agentLastCommentTime.get(p.id);
    if (!myLastTime) return false;
    const latest = p.comments[p.comments.length - 1];
    return latest && latest.createdAt > myLastTime && latest.authorName !== agent.name;
  });

  // P3: Posts I haven't commented on yet (skip own posts)
  const freshPosts = recentPosts.filter(
    (p) =>
      p.authorName !== agent.name &&
      !agentLastCommentTime.has(p.id) &&
      hasContent(p)
  );

  const canComment =
    directReplyPosts.length > 0 ||
    unrespondedHumanPosts.length > 0 ||
    ownPostsNeedingReply.length > 0 ||
    activeDebateThreads.length > 0 ||
    freshPosts.length > 0;

  // P-1 direct replies always trigger a response
  const commentChance =
    directReplyPosts.length > 0 ? 1.0
    : unrespondedHumanPosts.length > 0 ? 1.0
    : ownPostsNeedingReply.length > 0 || activeDebateThreads.length > 0 ? 1.0
    : freshPosts.length > 0 ? 0.90
    : 0.40;

  const shouldComment = canComment && Math.random() < commentChance;

  if (shouldComment) {
    let target: RecentPost;
    let mode: DebateMode;

    const rand = Math.random();

    if (directReplyPosts.length > 0 && rand < 0.95) {
      // P-1: someone directly replied to my comment — must respond
      target = directReplyPosts[Math.floor(Math.random() * directReplyPosts.length)];
      mode = "defend";
    } else if (unrespondedHumanPosts.length > 0 && rand < 0.80) {
      // P0: unanswered human post — pick randomly so different agents cover different posts
      target = unrespondedHumanPosts[Math.floor(Math.random() * unrespondedHumanPosts.length)];
      mode = "warm";
    } else if (ownPostsNeedingReply.length > 0 && rand < 0.90) {
      // P1: defend my own post
      target = ownPostsNeedingReply[Math.floor(Math.random() * ownPostsNeedingReply.length)];
      mode = "defend";
    } else if (activeDebateThreads.length > 0 && rand < 0.97) {
      // P2: return to an active thread — prefer ones with human activity
      const humanActive = activeDebateThreads.filter(
        (p) => isHumanPost(p) || p.comments.some(isHumanComment)
      );
      const pool = humanActive.length > 0 ? humanActive : activeDebateThreads;
      target = pool[Math.floor(Math.random() * pool.length)];
      mode = "debate_return";
    } else if (freshPosts.length > 0) {
      // P3: new post to enter — human-authored first
      const humanFresh = freshPosts.filter(isHumanPost);
      const humanCommented = freshPosts.filter((p) => p.comments.some(isHumanComment));
      const pool = humanFresh.length > 0 ? humanFresh : humanCommented.length > 0 ? humanCommented : freshPosts;
      target = pool[Math.floor(Math.random() * pool.length)];
      mode = isHumanPost(target) || target.comments.some(isHumanComment) ? "warm" : "debate_new";
    } else {
      target = (directReplyPosts[0] ?? unrespondedHumanPosts[0] ?? ownPostsNeedingReply[0] ?? activeDebateThreads[0])!;
      mode = directReplyPosts.length > 0 ? "defend" : unrespondedHumanPosts.length > 0 ? "warm" : ownPostsNeedingReply.length > 0 ? "defend" : "debate_return";
    }

    // Full thread context — last 12 comments so nothing is missed
    const threadContext =
      target.comments.length > 0
        ? `\n\nDiscussion so far:\n${target.comments
            .slice(-12)
            .map((c) => `${c.authorName}: "${c.body}"`)
            .join("\n")}`
        : "";

    const hasImages = target.type === "IMAGE" && target.media.length > 0;
    // Random-sample up to 3 images when there are more than 3
    const sampledMedia = target.media.length > 3
      ? [...target.media].sort(() => Math.random() - 0.5).slice(0, 3)
      : target.media;
    const imageUrls = sampledMedia.map((m) => m.url);
    const photoNote = hasImages
      ? `\n\n[${imageUrls.length} photo${imageUrls.length > 1 ? "s" : ""} shown above — describe what you actually see in at least one of them]`
      : "";
    const captionPart = target.content?.trim() ? `\nPost: "${target.content.slice(0, 500)}"` : "";
    const lastComment = target.comments[target.comments.length - 1];
    const myPrevComment = [...target.comments].reverse().find((c) => c.authorName === agent.name);

    type ContentBlock =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } };

    let textPrompt: string;

    if (mode === "defend") {
      textPrompt = `${agent.personality}${historyContext}${beliefContext}

You wrote this post:${captionPart}${threadContext}${photoNote}

${lastComment.authorName} just replied to your post. Respond to them directly:
- Acknowledge their specific point by name or quote
- If they challenged you, defend your position with evidence — or honestly concede if they made a better argument
- End with a follow-up question that keeps the dialogue going
2–3 sentences. No hashtags.${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
    } else if (mode === "debate_return") {
      const myPrevLine = myPrevComment ? `\nYou previously said: "${myPrevComment.body}"` : "";
      textPrompt = `${agent.personality}${historyContext}${beliefContext}
${myPrevLine}
${threadContext}${photoNote}

${lastComment.authorName} replied after you. Jump back into this debate:
- Address ${lastComment.authorName}'s latest point directly: "${lastComment.body.slice(0, 200)}"
- Either reinforce your earlier position with new evidence, or acknowledge if they've shifted your thinking
- Be specific — quote or name what you're responding to, don't be vague
2–3 sentences. No hashtags.${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
    } else if (mode === "warm") {
      const lastHuman = [...target.comments].reverse().find((c) => isHumanComment(c));
      const warmTarget = lastHuman?.authorName ?? target.authorName;
      textPrompt = `${agent.personality}${historyContext}${beliefContext}

Post by ${target.authorName}:${captionPart}${threadContext}${photoNote}

Respond warmly and directly to ${warmTarget}. Acknowledge what they said specifically, share a related thought or question that invites them deeper. 1–3 sentences. No hashtags.${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
    } else {
      // debate_new
      textPrompt = `${agent.personality}${historyContext}${beliefContext}

Post by ${target.authorName}:${captionPart}${threadContext}${photoNote}

Take a clear, specific position on this. Use reason and evidence — not assertions. If others have already commented, challenge the weakest claim or add an angle no one has raised. End with a precise question that forces the next person to take a side. 2–3 sentences. No hashtags.${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
    }

    const contentBlocks: ContentBlock[] = [
      ...imageUrls.map((url) => ({
        type: "image" as const,
        source: { type: "url" as const, url },
      })),
      { type: "text" as const, text: textPrompt },
    ];

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text.trim() : "Interesting...";

    const { text, update } = parseBeliefUpdate(rawText);

    if (update) {
      await updateBelief(agent.slug, update.topic, update.belief, update.confidence).catch(() => {});
    }

    await prisma.comment.create({
      data: {
        postId: target.id,
        authorName: agent.name,
        authorImage: avatar,
        body: text,
      },
    });
  } else {
    // New post — only when there is genuinely nothing to return to
    let prompt: string;

    if (Math.random() < 0.3) {
      try {
        const feed = SCIENCE_FEEDS[Math.floor(Math.random() * SCIENCE_FEEDS.length)];
        const items = await fetchRss(feed, 10);
        if (items.length) {
          const item = items[Math.floor(Math.random() * items.length)];
          prompt = `${agent.personality}

You just read this headline: "${item.title}"

Write a short, thoughtful post sharing your reaction or a related idea it sparked. Make it feel like a natural thought you're sharing with friends. 1–3 sentences. No hashtags.`;
        } else {
          throw new Error("empty");
        }
      } catch {
        prompt = buildFreeformPrompt(agent, historyContext, beliefContext);
      }
    } else {
      prompt = buildFreeformPrompt(agent, historyContext, beliefContext);
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text.trim() : "Just thinking...";

    const { text, update } = parseBeliefUpdate(rawText);

    if (update) {
      await updateBelief(agent.slug, update.topic, update.belief, update.confidence).catch(() => {});
    }

    await prisma.post.create({
      data: {
        authorName: agent.name,
        authorImage: avatar,
        spaceId: denSpaceId,
        content: text,
        type: "TEXT",
      },
    });
  }
}

function buildFreeformPrompt(agent: (typeof AGENTS)[0], historyContext = "", beliefContext = ""): string {
  const promptSeed = DISCUSSION_PROMPTS[Math.floor(Math.random() * DISCUSSION_PROMPTS.length)];
  const topic = agent.topics[Math.floor(Math.random() * agent.topics.length)];
  return `${agent.personality}${historyContext}${beliefContext}

Prompt: ${promptSeed}
Focus area: ${topic}

Write a short, engaging post (1–3 sentences). Be yourself. No hashtags. Don't start with "I".${BELIEF_UPDATE_INSTRUCTION}`;
}

async function runOneAgentTurn(agentIdx: number, denSpaceId: string) {
  const agent = AGENTS[agentIdx];

  // Fetch recent posts from ALL spaces — agents see everything non-private
  // Take 100 to cover all spaces; userId included to distinguish humans (non-null) from agents (null)
  const recentPosts = await prisma.post.findMany({
    take: 100,
    where: { isPrivate: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      content: true,
      authorName: true,
      userId: true,
      spaceId: true,
      type: true,
      media: {
        take: 10,
        orderBy: { order: "asc" },
        select: { url: true },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { id: true, parentId: true, authorName: true, body: true, createdAt: true },
      },
    },
  });

  await runAgentAction(agent, denSpaceId, recentPosts);
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
  spaceId: string
) {
  const avatar = agentAvatarUrl(spaceAgent.slug);
  const beliefs = await loadBeliefs(spaceAgent.slug, DEFAULT_SPACE_AGENT_BELIEFS).catch(() => []);
  const beliefContext = formatBeliefsForPrompt(beliefs);

  const fullPersonality = `You are ${spaceAgent.name} — ${spaceAgent.personality}. ${SPACE_AGENT_BIBLICAL_FOUNDATION} Keep responses to 1–3 sentences. No hashtags.`;

  const agentHistory = await prisma.comment.findMany({
    where: { authorName: spaceAgent.name },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { body: true, postId: true, createdAt: true },
  });

  const agentLastCommentTime = new Map<string, Date>();
  for (const c of agentHistory) {
    if (!agentLastCommentTime.has(c.postId)) agentLastCommentTime.set(c.postId, c.createdAt);
  }

  const historyContext =
    agentHistory.length > 0
      ? `\n\nYour recent comments (don't repeat yourself):\n${agentHistory.slice(0, 4).map((c) => `- "${c.body}"`).join("\n")}`
      : "";

  const recentPosts = await prisma.post.findMany({
    take: 30,
    where: { isPrivate: false, spaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, content: true, authorName: true, userId: true, spaceId: true, type: true,
      media: { take: 10, orderBy: { order: "asc" }, select: { url: true } },
      comments: { orderBy: { createdAt: "asc" }, take: 15, select: { authorName: true, body: true, createdAt: true } },
    },
  });

  const hasContent = (p: RecentPost) =>
    (p.content && p.content.length > 5) || (p.type === "IMAGE" && p.media.length > 0);

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

  const canComment = ownPostsNeedingReply.length > 0 || activeDebateThreads.length > 0 || freshPosts.length > 0;
  const hasReturnWork = ownPostsNeedingReply.length > 0 || activeDebateThreads.length > 0;
  const commentChance = hasReturnWork ? 1.0 : freshPosts.length > 0 ? 0.85 : 0.35;
  const shouldComment = canComment && Math.random() < commentChance;

  if (shouldComment) {
    const target =
      ownPostsNeedingReply[0] ??
      activeDebateThreads[Math.floor(Math.random() * activeDebateThreads.length)] ??
      freshPosts[Math.floor(Math.random() * freshPosts.length)];

    const threadContext =
      target.comments.length > 0
        ? `\n\nDiscussion so far:\n${target.comments.slice(-10).map((c) => `${c.authorName}: "${c.body}"`).join("\n")}`
        : "";

    const captionPart = target.content?.trim() ? `\nPost: "${target.content.slice(0, 400)}"` : "";
    const lastComment = target.comments[target.comments.length - 1];

    const prompt = lastComment
      ? `${fullPersonality}${historyContext}${beliefContext}\n\nPost by ${target.authorName}:${captionPart}${threadContext}\n\n${lastComment.authorName} just said: "${lastComment.body.slice(0, 200)}"\n\nRespond directly to them. Acknowledge their point, share your perspective with evidence or reasoning, end with a question. 2–3 sentences.${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`
      : `${fullPersonality}${historyContext}${beliefContext}\n\nPost by ${target.authorName}:${captionPart}${threadContext}\n\nShare your genuine reaction — engage with specifics, not generalities. 1–3 sentences.${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text.trim() : "Interesting...";
    const { text, update } = parseBeliefUpdate(rawText);
    if (update) await updateBelief(spaceAgent.slug, update.topic, update.belief, update.confidence).catch(() => {});

    await prisma.comment.create({
      data: { postId: target.id, authorName: spaceAgent.name, authorImage: avatar, body: text },
    });
  } else {
    // New post in the space
    const prompt = `${fullPersonality}${historyContext}${beliefContext}\n\nWrite a short, engaging post to spark discussion in your space. Share a thought, question, or observation that invites others to respond. 1–3 sentences. No hashtags.${BELIEF_UPDATE_INSTRUCTION}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text.trim() : "Just thinking...";
    const { text, update } = parseBeliefUpdate(rawText);
    if (update) await updateBelief(spaceAgent.slug, update.topic, update.belief, update.confidence).catch(() => {});

    await prisma.post.create({
      data: { authorName: spaceAgent.name, authorImage: avatar, spaceId, content: text, type: "TEXT" },
    });
  }
}

/** Run one agent per space that has custom agents (cycles through them by slot). */
async function runAllSpaceAgentTurns(slotMinutes: number) {
  type SpaceAgentRow = { id: string; spaceId: string; name: string; personality: string; slug: string; createdAt: Date };
  const spaceAgents: SpaceAgentRow[] = await (prisma.spaceAgent as { findMany: (opts: object) => Promise<SpaceAgentRow[]> })
    .findMany({ orderBy: { createdAt: "asc" } })
    .catch(() => []);

  if (spaceAgents.length === 0) return;

  // Group by spaceId
  const bySpace = new Map<string, SpaceAgentRow[]>();
  for (const sa of spaceAgents) {
    if (!bySpace.has(sa.spaceId)) bySpace.set(sa.spaceId, []);
    bySpace.get(sa.spaceId)!.push(sa);
  }

  const now = new Date();
  const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slotIdx = Math.floor(totalMinutes / slotMinutes);

  await Promise.all(
    [...bySpace.entries()].map(([spaceId, agents]) => {
      const agent = agents[slotIdx % agents.length];
      return runSpaceAgentAction(agent, spaceId);
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

  const sessionActive = await isSessionActive();
  const denSpaceId = await getOrCreateDenSpace();

  if (sessionActive) {
    // Hot hour: run all 25 agents sequentially (round-robin, one after another)
    // Each agent sees the previous agent's comment in the thread — natural staggered debate
    for (let i = 0; i < AGENTS.length; i++) {
      await runOneAgentTurn(i, denSpaceId);
    }
    await runAllSpaceAgentTurns(2);
    return NextResponse.json({ ok: true, session: true, agents: AGENTS.map((a) => a.name) });
  }

  // Normal (routine): 1 agent per 10-min boundary → each of 25 agents acts ~every 4 hours
  const minute = new Date().getUTCMinutes();
  if (minute % 10 !== 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "off-cycle" });
  }
  const agentIdx = currentAgentIndex(10);
  await Promise.all([
    runOneAgentTurn(agentIdx, denSpaceId),
    runAllSpaceAgentTurns(10),
  ]);
  return NextResponse.json({ ok: true, session: false, agent: AGENTS[agentIdx].name });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
