import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { isCronAuthorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl } from "@/lib/agents";
import { generateInviteCode } from "@/lib/invite";
import { authOptions } from "@/lib/auth";
import { fetchRss, SCIENCE_FEEDS } from "@/lib/rss";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
];

async function getOrCreateDenSpace(): Promise<string> {
  const existing = await prisma.space.findFirst({
    where: { isSystem: true, name: AGENT_SPACE_NAME },
  });
  if (existing) return existing.id;

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


type RecentPost = {
  id: string;
  content: string | null;
  authorName: string;
  spaceId: string | null;
  comments: { authorName: string; body: string }[];
};

/** Fire one action for a single agent: either a new post or a comment on a recent post/comment-thread. */
async function runAgentAction(
  agent: (typeof AGENTS)[0],
  denSpaceId: string,
  recentPosts: RecentPost[]
) {
  const avatar = agentAvatarUrl(agent.slug);

  // 65% chance: comment on a recent post (drives discussion); 35% chance: new post
  const shouldComment = Math.random() < 0.65 && recentPosts.length > 0;

  if (shouldComment) {
    // Prefer posts that already have comments (active threads)
    const withComments = recentPosts.filter(
      (p) => p.authorName !== agent.name && p.content && p.content.length > 20 && p.comments.length > 0
    );
    const withoutComments = recentPosts.filter(
      (p) => p.authorName !== agent.name && p.content && p.content.length > 20 && p.comments.length === 0
    );
    // 70% chance pick an active thread, 30% pick a fresh post
    const eligible = withComments.length > 0 && Math.random() < 0.7 ? withComments : withoutComments;
    if (!eligible.length && recentPosts.filter(p => p.content && p.content.length > 20).length === 0) return;
    const pool = eligible.length > 0 ? eligible : recentPosts.filter(p => p.authorName !== agent.name && p.content && p.content.length > 20);
    if (!pool.length) return;

    const target = pool[Math.floor(Math.random() * pool.length)];

    // Build conversation thread for context
    const threadContext = target.comments.length > 0
      ? `\n\nThe discussion so far:\n${target.comments.slice(-6).map(c => `${c.authorName}: "${c.body}"`).join("\n")}`
      : "";

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `${agent.personality}

Post by ${target.authorName}:
"${target.content?.slice(0, 500)}"${threadContext}

Write a genuine, interesting reply as yourself. React to the post or the ongoing discussion — agree, push back, add a new angle, ask a follow-up question, or share a related insight. If others have already commented, engage with their ideas too. Be natural and conversational. 1–3 sentences. No hashtags.`,
        },
      ],
    });

    const text =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "Interesting...";

    await prisma.comment.create({
      data: {
        postId: target.id,
        authorName: agent.name,
        authorImage: avatar,
        body: text,
      },
    });
  } else {
    // New post — sometimes science-news-inspired, sometimes spontaneous
    let prompt: string;

    if (Math.random() < 0.3) {
      // Try to get a science headline for inspiration
      try {
        const feed = SCIENCE_FEEDS[Math.floor(Math.random() * SCIENCE_FEEDS.length)];
        const items = await fetchRss(feed, 10);
        if (items.length) {
          const item = items[Math.floor(Math.random() * items.length)];
          prompt = `${agent.personality}

You just read this headline: "${item.title}"

Write a short, thoughtful post sharing your reaction or a related idea it sparked. Make it feel like a natural thought you're sharing with friends, not a news report. 1–3 sentences. No hashtags.`;
        } else {
          throw new Error("empty");
        }
      } catch {
        prompt = buildFreeformPrompt(agent);
      }
    } else {
      prompt = buildFreeformPrompt(agent);
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "Just thinking...";

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

function buildFreeformPrompt(agent: (typeof AGENTS)[0]): string {
  const promptSeed =
    DISCUSSION_PROMPTS[Math.floor(Math.random() * DISCUSSION_PROMPTS.length)];
  const topic = agent.topics[Math.floor(Math.random() * agent.topics.length)];
  return `${agent.personality}

Prompt: ${promptSeed}
Focus area: ${topic}

Write a short, engaging post (1–3 sentences). Be yourself. No hashtags. Don't start with "I".`;
}

async function runDiscussionRound(denSpaceId: string) {
  // Get recent posts from ALL spaces (agents read everything) with recent comment threads
  const recentPosts = await prisma.post.findMany({
    take: 60,
    where: { isPrivate: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      content: true,
      authorName: true,
      spaceId: true,
      comments: {
        orderBy: { createdAt: "asc" },
        take: 10,
        select: { authorName: true, body: true },
      },
    },
  });

  // Each agent gets a chance — run sequentially to avoid rate limits
  const shuffled = [...AGENTS].sort(() => Math.random() - 0.5);
  for (const agent of shuffled) {
    try {
      await runAgentAction(agent, denSpaceId, recentPosts);
    } catch (e) {
      console.error(`Agent ${agent.name} error:`, e);
    }
    // Small delay between agents to avoid Anthropic rate limits
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function POST(req: NextRequest) {
  // Accept cron secret OR a valid user session (client trigger from the Den page)
  if (!isCronAuthorized(req)) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const denSpaceId = await getOrCreateDenSpace();

  // Run in background so the HTTP response returns quickly
  runDiscussionRound(denSpaceId).catch(console.error);

  return NextResponse.json({ ok: true, spaceId: denSpaceId });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
