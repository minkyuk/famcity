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

/** Determine which agent should act based on current UTC minute (6-minute rotation) */
function currentAgentIndex(): number {
  return Math.floor(new Date().getUTCMinutes() / 6) % AGENTS.length;
}

type RecentPost = {
  id: string;
  content: string | null;
  authorName: string;
  spaceId: string | null;
  type: string;
  media: { url: string }[];
  comments: { authorName: string; body: string }[];
};

/** Fire one action for a single agent: either a new post or a comment on a recent post/thread. */
async function runAgentAction(agent: (typeof AGENTS)[0], denSpaceId: string, recentPosts: RecentPost[]) {
  const avatar = agentAvatarUrl(agent.slug);

  // Try to comment (65% chance) if there are eligible posts
  const eligible = recentPosts.filter(
    (p) => p.authorName !== agent.name && p.content && p.content.length > 20
  );

  const shouldComment = Math.random() < 0.65 && eligible.length > 0;

  if (shouldComment) {
    // Prefer posts that already have an active discussion thread
    const withComments = eligible.filter((p) => p.comments.length > 0);
    const target =
      withComments.length > 0 && Math.random() < 0.7
        ? withComments[Math.floor(Math.random() * withComments.length)]
        : eligible[Math.floor(Math.random() * eligible.length)];

    // Build thread context from last 6 comments
    const threadContext =
      target.comments.length > 0
        ? `\n\nThe discussion so far:\n${target.comments
            .slice(-6)
            .map((c) => `${c.authorName}: "${c.body}"`)
            .join("\n")}`
        : "";

    // Build the message content — add vision for image posts
    const hasImages = target.type === "IMAGE" && target.media.length > 0;
    const imageUrls = target.media.slice(0, 2).map((m) => m.url); // up to 2 images

    type ContentBlock =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } };

    const textPrompt = `${agent.personality}

Post by ${target.authorName}:
"${target.content?.slice(0, 500)}"${threadContext}${hasImages ? "\n\n[This post includes photos shown above]" : ""}

Write a genuine, interesting reply as yourself. React to the post or the ongoing discussion — agree, push back, add a new angle, ask a follow-up question, or share a related insight.${hasImages ? " You can see the photos — respond to what you actually see in them." : ""} If others have already commented, engage with their ideas too. Be natural and conversational. 1–3 sentences. No hashtags.`;

    const contentBlocks: ContentBlock[] = [
      ...imageUrls.map((url) => ({
        type: "image" as const,
        source: { type: "url" as const, url },
      })),
      { type: "text" as const, text: textPrompt },
    ];

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "Interesting...";

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
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "Just thinking...";

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
  const promptSeed = DISCUSSION_PROMPTS[Math.floor(Math.random() * DISCUSSION_PROMPTS.length)];
  const topic = agent.topics[Math.floor(Math.random() * agent.topics.length)];
  return `${agent.personality}

Prompt: ${promptSeed}
Focus area: ${topic}

Write a short, engaging post (1–3 sentences). Be yourself. No hashtags. Don't start with "I".`;
}

async function runOneAgentTurn(agentIdx: number, denSpaceId: string) {
  const agent = AGENTS[agentIdx];

  // Fetch recent posts from ALL spaces (agents read everything) with comment threads + media
  const recentPosts = await prisma.post.findMany({
    take: 60,
    where: { isPrivate: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      content: true,
      authorName: true,
      spaceId: true,
      type: true,
      media: {
        take: 2,
        orderBy: { order: "asc" },
        select: { url: true },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 10,
        select: { authorName: true, body: true },
      },
    },
  });

  await runAgentAction(agent, denSpaceId, recentPosts);
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
  const agentIdx = currentAgentIndex();

  // Run in background so the HTTP response returns quickly
  runOneAgentTurn(agentIdx, denSpaceId).catch(console.error);

  return NextResponse.json({ ok: true, spaceId: denSpaceId, agent: AGENTS[agentIdx].name });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
