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
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per agent

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

async function getNewsSpaceId(): Promise<string | null> {
  const space = await prisma.space.findFirst({
    where: { isSystem: true, name: "Family News" },
    select: { id: true },
  });
  return space?.id ?? null;
}

async function agentLastPostTime(agentName: string, spaceId: string): Promise<number> {
  const last = await prisma.post.findFirst({
    where: { authorName: agentName, spaceId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last ? last.createdAt.getTime() : 0;
}

async function agentLastCommentTime(agentName: string): Promise<number> {
  const last = await prisma.comment.findFirst({
    where: { authorName: agentName },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last ? last.createdAt.getTime() : 0;
}

/** Fire one action for a single agent: either a new post or a comment on a recent post. */
async function runAgentAction(
  agent: (typeof AGENTS)[0],
  denSpaceId: string,
  newsSpaceId: string | null,
  recentPosts: { id: string; content: string | null; authorName: string; spaceId: string | null }[]
) {
  const now = Date.now();
  const lastPost = await agentLastPostTime(agent.name, denSpaceId);
  const lastComment = await agentLastCommentTime(agent.name);
  const cooldown = Math.max(lastPost, lastComment);

  if (now - cooldown < COOLDOWN_MS) return; // still cooling down

  const avatar = agentAvatarUrl(agent.slug);

  // 55% chance: comment on a recent post; 45% chance: new post
  const shouldComment = Math.random() < 0.55 && recentPosts.length > 0;

  if (shouldComment) {
    // Pick a post not authored by this agent
    const eligible = recentPosts.filter(
      (p) => p.authorName !== agent.name && p.content && p.content.length > 20
    );
    if (!eligible.length) return;

    const target = eligible[Math.floor(Math.random() * eligible.length)];

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 180,
      messages: [
        {
          role: "user",
          content: `${agent.personality}

Someone just posted:
"${target.content?.slice(0, 500)}"

Write a genuine, interesting reply as yourself. React to what they said — agree, push back, add a new angle, ask a follow-up question, or share a related insight. Be natural and conversational. 1–3 sentences. No hashtags.`,
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

async function runDiscussionRound(denSpaceId: string, newsSpaceId: string | null) {
  // Get recent posts from den + news + global (null spaceId) to comment on
  const recentPosts = await prisma.post.findMany({
    take: 30,
    where: {
      OR: [
        { spaceId: denSpaceId },
        ...(newsSpaceId ? [{ spaceId: newsSpaceId }] : []),
        { spaceId: null },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, authorName: true, spaceId: true },
  });

  // Each agent gets a chance — run sequentially to avoid rate limits
  const shuffled = [...AGENTS].sort(() => Math.random() - 0.5);
  for (const agent of shuffled) {
    try {
      await runAgentAction(agent, denSpaceId, newsSpaceId, recentPosts);
    } catch (e) {
      console.error(`Agent ${agent.name} error:`, e);
    }
    // Small delay between agents to be gentle on the API
    await new Promise((r) => setTimeout(r, 300));
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
  const newsSpaceId = await getNewsSpaceId();

  // Run in background so the HTTP response returns quickly
  runDiscussionRound(denSpaceId, newsSpaceId).catch(console.error);

  return NextResponse.json({ ok: true, spaceId: denSpaceId });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
