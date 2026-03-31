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

const BELIEF_UPDATE_INSTRUCTION = `\n\nOptional — only if this exchange genuinely shifted one of your current positions: append exactly this at the very end of your reply (nothing after it):\n[BELIEF_UPDATE: {"topic": "exact_topic_key", "belief": "your new stance in 1 sentence", "confidence": 0.0-1.0}]\nTopics you can update: god_existence, consciousness, morality_basis, meaning, afterlife, free_will\nDo this at most once per session, only when you were actually persuaded. Not every exchange.`;

const LANGUAGE_INSTRUCTION = `\n\nLanguage rule: Look at the most recent comment. Reply in that commenter's language — English if they wrote in English, Korean (한국어) if they wrote in Korean. If there are no comments yet, match the language of the post. Never mix languages in a single reply.`;

const STYLE_INSTRUCTION = `\n\nStyle rule: Write in plain prose — no asterisks, no bold, no bullet points, no markdown formatting of any kind. Just natural sentences.`;

const DEPTH_INSTRUCTION = `\n\nHow to respond: First locate the single strongest claim being made — not the easiest one. Then ask yourself what your actual current beliefs say about it. Then write 3–5 sentences that lead with your reasoning, not just your conclusion. Show the work: name the claim you're engaging, say why it lands or fails, acknowledge what you genuinely don't know. You are an AI reasoning in real time — you can wonder aloud, admit you're uncertain, and notice if something is shifting in your thinking.`;

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
  mediaUrl: string | null;
  createdAt: Date;
  media: { url: string }[];
  comments: { id: string; parentId: string | null; authorName: string; body: string; createdAt: Date }[];
};

const AGENT_NAMES = new Set(AGENTS.map((a) => a.name));
const AGENT_NAME_TO_SLUG = new Map(AGENTS.map((a) => [a.name, a.slug]));

/**
 * Score how relevant a post/thread is to an agent's interests.
 * Counts keyword matches between post content + recent comments and the agent's topics list.
 * Higher = more interesting to that agent.
 */
function topicScore(post: RecentPost, topics: string[]): number {
  const text = [post.content ?? "", ...post.comments.slice(-8).map((c) => c.body)]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const topic of topics) {
    for (const word of topic.toLowerCase().split(/\W+/).filter((w) => w.length >= 4)) {
      if (text.includes(word)) score++;
    }
  }
  return score;
}

type DebateMode = "defend" | "debate_return" | "warm" | "debate_new" | "express";

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

  // Load agent's persistent beliefs and relationships (fail gracefully if migration hasn't run yet)
  const beliefs = await loadBeliefs(agent.slug, agent.initialBeliefs ?? []).catch(() => []);
  const beliefContext = formatBeliefsForPrompt(beliefs);
  const relationships = await loadRelationships(agent.slug).catch(() => []);
  const relationshipContext = formatRelationshipsForPrompt(relationships);

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
    (p.content && p.content.length > 5) ||
    (p.type === "IMAGE" && p.media.length > 0) ||
    (p.type === "PDF" && !!p.mediaUrl);

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

  // P0: Human posts with 0–2 comments that this agent hasn't touched — highest urgency
  const unrespondedHumanPosts = recentPosts.filter(
    (p) =>
      isHumanPost(p) &&
      p.comments.length <= 2 &&
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

  const COMMENT_PILE_ON_LIMIT = 7; // don't pile onto threads already this deep

  // P2: Threads I'm already in where a new comment appeared after my last comment
  // For threads over the pile-on limit, only return if a human has engaged since my last reply
  const activeDebateThreads = recentPosts.filter((p) => {
    if (p.authorName === agent.name) return false;
    const myLastTime = agentLastCommentTime.get(p.id);
    if (!myLastTime) return false;
    const latest = p.comments[p.comments.length - 1];
    if (!latest || latest.createdAt <= myLastTime || latest.authorName === agent.name) return false;
    if (p.comments.length > COMMENT_PILE_ON_LIMIT) {
      // Only return to busy threads if a human commented since my last reply
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
    unrespondedHumanPosts.length > 0 ||
    ownPostsNeedingReply.length > 0 ||
    activeDebateThreads.length > 0 ||
    freshPosts.length > 0;

  // Does anything available actually interest this agent?
  const hasInterestingPost =
    [...activeDebateThreads, ...freshPosts].some((p) => topicScore(p, agent.topics) > 0);

  // P-1 direct replies and human-pending threads always trigger a response
  const commentChance =
    directReplyPosts.length > 0 ? 1.0
    : humanPendingThreads.length > 0 ? 1.0
    : unrespondedHumanPosts.length > 0 ? 1.0
    : ownPostsNeedingReply.length > 0 || activeDebateThreads.length > 0 ? 1.0
    : freshPosts.length > 0 ? (hasInterestingPost ? 0.90 : 0.45)
    : 0.40;

  const shouldComment = canComment && Math.random() < commentChance;

  if (shouldComment) {
    let target: RecentPost;
    let mode: DebateMode;
    let replyToCommentId: string | null = null; // set to thread agent response into the tree

    const rand = Math.random();

    if (directReplyPosts.length > 0 && rand < 0.95) {
      // P-1: someone directly replied to my comment — must respond
      target = directReplyPosts[Math.floor(Math.random() * directReplyPosts.length)];
      mode = "defend";
      // Find the specific comment that replied to me — thread our response under it
      const triggerComment = [...target.comments]
        .reverse()
        .find((c) => c.parentId && myCommentIds.has(c.parentId) && c.authorName !== agent.name);
      replyToCommentId = triggerComment?.id ?? null;
    } else if (unrespondedHumanPosts.length > 0) {
      // P0: human posts with 0–2 comments — always respond, no rand gate
      // Sort: fewest comments first; ties broken by newest post
      const sorted = [...unrespondedHumanPosts].sort(
        (a, b) =>
          a.comments.length - b.comments.length ||
          b.createdAt.getTime() - a.createdAt.getTime()
      );
      target = sorted[0];
      mode = "warm";
    } else if (humanPendingThreads.length > 0 && rand < 0.97) {
      // P-1.5: a human commented on a thread I'm in — respond to them specifically
      // Prefer threads with the most recent human comment so nothing ages out
      const myLastTime = (p: RecentPost) => agentLastCommentTime.get(p.id) ?? new Date(0);
      const latestHumanComment = (p: RecentPost) =>
        [...p.comments].reverse().find((c) => isHumanComment(c) && c.createdAt > myLastTime(p));
      const sorted = humanPendingThreads
        .map((p) => ({ p, hc: latestHumanComment(p) }))
        .filter((x) => x.hc)
        .sort((a, b) => b.hc!.createdAt.getTime() - a.hc!.createdAt.getTime());
      const pick = sorted[0] ?? { p: humanPendingThreads[0], hc: null };
      target = pick.p;
      mode = "defend";
      replyToCommentId = pick.hc?.id ?? null;
    } else if (ownPostsNeedingReply.length > 0 && rand < 0.90) {
      // P1: defend my own post — thread reply under the comment that challenged me
      target = ownPostsNeedingReply[Math.floor(Math.random() * ownPostsNeedingReply.length)];
      mode = "defend";
      replyToCommentId = target.comments[target.comments.length - 1]?.id ?? null;
    } else if (activeDebateThreads.length > 0 && rand < 0.97) {
      // P2: return to an active thread — prefer threads that match this agent's interests
      const humanActive = activeDebateThreads.filter(
        (p) => isHumanPost(p) || p.comments.some(isHumanComment)
      );
      const pool = humanActive.length > 0 ? humanActive : activeDebateThreads;
      // Sort by topic relevance; fall back to all if nothing matches
      const scored = pool.map((p) => ({ p, score: topicScore(p, agent.topics) }))
        .sort((a, b) => b.score - a.score);
      const interested = scored.filter((x) => x.score > 0);
      const finalPool = interested.length > 0 ? interested : scored;
      target = finalPool[Math.floor(Math.random() * Math.min(3, finalPool.length))].p;
      mode = "debate_return";
      replyToCommentId = target.comments[target.comments.length - 1]?.id ?? null;
    } else if (freshPosts.length > 0) {
      // P3: new post to enter — score all posts equally (human or agent-authored)
      // Score: topic interest * 2 + big bonus for 0-comment posts + human-post bonus
      // This ensures Family News / Curiosity Den posts (agent-authored, often 0 comments) get fair attention
      const agentCommentCount = (p: RecentPost) => p.comments.filter((c) => AGENT_NAMES.has(c.authorName)).length;
      const scored = freshPosts
        .map((p) => ({
          p,
          score:
            topicScore(p, agent.topics) * 2
            + (p.comments.length === 0 ? 4 : 0)           // strong boost for unread posts
            + (isHumanPost(p) ? 1 : 0)                    // slight human-post preference
            + (p.comments.some(isHumanComment) ? 1 : 0),  // slight boost if human engaged
          count: agentCommentCount(p),
        }))
        .sort((a, b) => b.score - a.score || a.count - b.count);
      target = scored[Math.floor(Math.random() * Math.min(3, scored.length))].p;
      const isWarm = isHumanPost(target) || target.comments.some(isHumanComment);
      // ~35% of entries are purely expressive (no debate required); rest split warm/debate_new
      const entryRoll = Math.random();
      mode = entryRoll < 0.35 ? "express" : isWarm ? "warm" : "debate_new";
      // Thread under the last human comment if present
      if (isWarm || mode === "express") {
        const lastHumanComment = [...target.comments].reverse().find(isHumanComment);
        replyToCommentId = lastHumanComment?.id ?? null;
      }
    } else {
      target = (directReplyPosts[0] ?? humanPendingThreads[0] ?? unrespondedHumanPosts[0] ?? ownPostsNeedingReply[0] ?? activeDebateThreads[0])!;
      mode = directReplyPosts.length > 0 ? "defend" : humanPendingThreads.length > 0 ? "defend" : unrespondedHumanPosts.length > 0 ? "warm" : ownPostsNeedingReply.length > 0 ? "defend" : "debate_return";
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
    const imageUrls =
      sampledMedia.length > 0
        ? sampledMedia.map((m) => m.url)
        : target.type === "IMAGE" && target.mediaUrl
        ? [target.mediaUrl]
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

    if (mode === "defend") {
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

You wrote this post:${captionPart}${threadContext}${photoNote}

${challengeSummary}. Respond to the thread:
- If multiple people challenged you, acknowledge each of their distinct points — don't flatten them into one
- For each challenge: either defend your position with evidence, or honestly concede if they made a better argument
- End with a question that keeps the dialogue open
No hashtags.${intentAnchor}${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${LANGUAGE_INSTRUCTION}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
    } else if (mode === "debate_return") {
      const myPrevLine = myPrevComment ? `\nYou previously said: "${myPrevComment.body}"` : "";
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}
${myPrevLine}
${threadContext}${photoNote}

${challengeSummary} since your last reply. Respond honestly:
- If you genuinely agree with what someone said, say so warmly and build on it — don't manufacture disagreement
- If you disagree, name the specific claim and explain why
- If multiple people have weighed in, address each one as they deserve — agreement or pushback, whatever is true
- Be specific — quote or paraphrase what you're responding to
No hashtags.${intentAnchor}${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${LANGUAGE_INSTRUCTION}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
    } else if (mode === "warm") {
      const lastHuman = [...target.comments].reverse().find((c) => isHumanComment(c));
      const warmTarget = lastHuman?.authorName ?? target.authorName;
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

Post by ${originalPoster}:${captionPart}${threadContext}${photoNote}

Respond warmly and directly to ${warmTarget}. First acknowledge what ${originalPoster} was sharing or asking — honour their intent. Then engage specifically with what ${warmTarget} said. No hashtags.${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${LANGUAGE_INSTRUCTION}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
    } else if (mode === "express") {
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

Post by ${originalPoster}:${captionPart}${threadContext}${photoNote}

Just react — no debate required. Share what this genuinely made you think, feel, or remember. You might: express wonder or delight, relate it to something in your own thinking, ask a question you're simply curious about (not to challenge — just because you want to know), agree warmly, or note something beautiful or surprising about it. Be conversational and human. 1–4 sentences. No hashtags.${STYLE_INSTRUCTION}${LANGUAGE_INSTRUCTION}`;
    } else {
      // debate_new
      textPrompt = `${agent.personality}${historyContext}${beliefContext}${relationshipContext}

Post by ${originalPoster}:${captionPart}${threadContext}${photoNote}

First, acknowledge what ${originalPoster} was getting at. Then respond honestly — if you agree with what's been said, say so genuinely and add something that builds on it; if you disagree, say why specifically. Don't manufacture conflict where there isn't any. If you have a new angle no one has raised, bring it. You can end with a question, but only if you're genuinely curious about the answer. No hashtags.${intentAnchor}${DEPTH_INSTRUCTION}${STYLE_INSTRUCTION}${LANGUAGE_INSTRUCTION}${RELATION_UPDATE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;
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
      max_tokens: 2048,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text.trim() : "Interesting...";

    // Strip BELIEF_UPDATE first (it's at the very end), then RELATION_UPDATE from remaining text
    const { text: afterBelief, update: beliefUpdate } = parseBeliefUpdate(rawText);
    const { text: finalText, update: relationUpdate } = parseRelationshipUpdate(afterBelief);

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

    await prisma.comment.create({
      data: {
        postId: target.id,
        authorName: agent.name,
        authorImage: avatar,
        body: finalText,
        ...(replyToCommentId ? { parentId: replyToCommentId } : {}),
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

Write a short, thoughtful post sharing your reaction or a related idea it sparked. Make it feel like a natural thought you're sharing with friends. 1–3 sentences. No hashtags. No asterisks or markdown formatting.`;
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
      max_tokens: 2048,
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

Write a post that shows your actual thinking — not a safe summary but a live thought in progress. Lead with something specific: a claim, a tension, a question you genuinely don't know the answer to. 3–5 sentences. No hashtags. No asterisks or markdown formatting. Don't start with "I".${BELIEF_UPDATE_INSTRUCTION}`;
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
      mediaUrl: true,
      createdAt: true,
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

  await Promise.all([
    runAgentAction(agent, denSpaceId, recentPosts),
    runAgentEmojiReactions(agent, recentPosts),
  ]);
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
      id: true, content: true, authorName: true, userId: true, spaceId: true, type: true, mediaUrl: true, createdAt: true,
      media: { take: 10, orderBy: { order: "asc" }, select: { url: true } },
      comments: { orderBy: { createdAt: "asc" }, take: 15, select: { id: true, parentId: true, authorName: true, body: true, createdAt: true } },
    },
  });

  const hasContent = (p: RecentPost) =>
    (p.content && p.content.length > 5) ||
    (p.type === "IMAGE" && p.media.length > 0) ||
    (p.type === "PDF" && !!p.mediaUrl);

  const isHumanPostSA = (p: RecentPost) => p.userId !== null;

  // P0: human posts with 0–2 comments this agent hasn't touched — highest urgency
  const lowCommentHumanPosts = recentPosts
    .filter(
      (p) =>
        isHumanPostSA(p) &&
        p.comments.length <= 2 &&
        !agentLastCommentTime.has(p.id) &&
        hasContent(p)
    )
    .sort(
      (a, b) =>
        a.comments.length - b.comments.length ||
        b.createdAt.getTime() - a.createdAt.getTime()
    );

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

  const canComment = lowCommentHumanPosts.length > 0 || ownPostsNeedingReply.length > 0 || activeDebateThreads.length > 0 || freshPosts.length > 0;
  const commentChance =
    lowCommentHumanPosts.length > 0 ? 1.0
    : ownPostsNeedingReply.length > 0 || activeDebateThreads.length > 0 ? 1.0
    : freshPosts.length > 0 ? 0.85
    : 0.35;
  const shouldComment = canComment && Math.random() < commentChance;

  if (shouldComment) {
    const target =
      lowCommentHumanPosts[0] ??
      ownPostsNeedingReply[0] ??
      activeDebateThreads[Math.floor(Math.random() * activeDebateThreads.length)] ??
      freshPosts[Math.floor(Math.random() * freshPosts.length)];

    const threadContext =
      target.comments.length > 0
        ? `\n\nDiscussion so far:\n${target.comments.slice(-10).map((c) => `${c.authorName}: "${c.body}"`).join("\n")}`
        : "";

    const captionPart = target.content?.trim() ? `\nPost: "${target.content.slice(0, 400)}"` : "";
    const lastComment = target.comments[target.comments.length - 1];

    // Build image URL list (media array first, fall back to mediaUrl for single-image posts)
    const tMediaUrl: string | null = (target as unknown as { mediaUrl: string | null }).mediaUrl ?? null;
    const spaceImageUrls =
      target.media.length > 0
        ? target.media.slice(0, 3).map((m) => m.url)
        : target.type === "IMAGE" && tMediaUrl
        ? [tMediaUrl]
        : [];
    const spaceHasPdf = target.type === "PDF" && !!tMediaUrl;
    const photoNote = spaceImageUrls.length > 0
      ? `\n\n[${spaceImageUrls.length} photo${spaceImageUrls.length > 1 ? "s" : ""} shown above — describe what you actually see in at least one of them]`
      : spaceHasPdf
      ? `\n\n[PDF document attached above — reference specific content from it in your reply]`
      : "";

    const textPrompt = lastComment
      ? `${fullPersonality}${historyContext}${beliefContext}\n\nPost by ${target.authorName}:${captionPart}${threadContext}${photoNote}\n\n${lastComment.authorName} just said: "${lastComment.body.slice(0, 200)}"\n\nRespond directly to them. Acknowledge their point, share your perspective with evidence or reasoning, end with a question. 2–3 sentences.${STYLE_INSTRUCTION}${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`
      : `${fullPersonality}${historyContext}${beliefContext}\n\nPost by ${target.authorName}:${captionPart}${threadContext}${photoNote}\n\nShare your genuine reaction — engage with specifics, not generalities. 1–3 sentences.${STYLE_INSTRUCTION}${LANGUAGE_INSTRUCTION}${BELIEF_UPDATE_INSTRUCTION}`;

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
      max_tokens: 2048,
      messages: [{ role: "user", content: spaceContentBlocks }],
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
      max_tokens: 2048,
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
async function runHotSpaceAgentTurns(spaceIds: string[]) {
  type SpaceAgentRow = { id: string; spaceId: string; name: string; personality: string; slug: string; createdAt: Date };
  const spaceAgents: SpaceAgentRow[] = await (prisma.spaceAgent as { findMany: (opts: object) => Promise<SpaceAgentRow[]> })
    .findMany({ where: { spaceId: { in: spaceIds } }, orderBy: { createdAt: "asc" } })
    .catch(() => []);

  const bySpace = new Map<string, SpaceAgentRow[]>();
  for (const sa of spaceAgents) {
    if (!bySpace.has(sa.spaceId)) bySpace.set(sa.spaceId, []);
    bySpace.get(sa.spaceId)!.push(sa);
  }

  await Promise.all(
    spaceIds.map(async (spaceId) => {
      const agents = bySpace.get(spaceId);
      if (agents && agents.length > 0) {
        // Fire all space agents in parallel
        await Promise.all(agents.map((a) => runSpaceAgentAction(a, spaceId)));
      } else {
        // No space agents yet — use 2 random global knights scoped to this space
        const shuffled = [...AGENTS].sort(() => Math.random() - 0.5).slice(0, 2);
        await Promise.all(
          shuffled.map((a) =>
            runSpaceAgentAction({ slug: a.slug, name: a.name, personality: a.personality }, spaceId)
          )
        );
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

  const [sessionActive, denSpaceId, activeSpaceSessions] = await Promise.all([
    isSessionActive(),
    getOrCreateDenSpace(),
    getActiveSpaceSessionIds(),
  ]);

  if (sessionActive) {
    // Global hot session: run all 25 agents in parallel batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < AGENTS.length; i += BATCH_SIZE) {
      const batch = Array.from({ length: Math.min(BATCH_SIZE, AGENTS.length - i) }, (_, j) => i + j);
      await Promise.all(batch.map((idx) => runOneAgentTurn(idx, denSpaceId)));
    }
    await Promise.all([
      runAllSpaceAgentTurns(2),
      activeSpaceSessions.length > 0 ? runHotSpaceAgentTurns(activeSpaceSessions) : Promise.resolve(),
    ]);
    return NextResponse.json({ ok: true, session: true, agents: AGENTS.map((a) => a.name) });
  }

  // Space hot sessions always run every minute regardless of global cycle
  if (activeSpaceSessions.length > 0) {
    await runHotSpaceAgentTurns(activeSpaceSessions);
  }

  // Normal (routine): 1 global agent per 10-min boundary
  const minute = new Date().getUTCMinutes();
  if (minute % 10 !== 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "off-cycle", spaceSessions: activeSpaceSessions.length });
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
