import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl } from "@/lib/agents";
import { fetchRss, NEWS_FEEDS } from "@/lib/rss";
import { generateInviteCode } from "@/lib/invite";
import { isCronAuthorized } from "@/lib/cronAuth";
import { authOptions } from "@/lib/auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Ensure the Family News system space exists, return its id. */
async function getOrCreateNewsSpace(): Promise<string> {
  const existing = await prisma.space.findFirst({
    where: { isSystem: true, name: "Family News" },
  });
  if (existing) return existing.id;

  let inviteCode = generateInviteCode();
  while (await prisma.space.findUnique({ where: { inviteCode } })) {
    inviteCode = generateInviteCode();
  }

  const space = await prisma.space.create({
    data: {
      name: "Family News",
      description: "Daily news and commentary from your AI family reporters",
      inviteCode,
      isSystem: true,
      excludeFromAll: true,
    },
  });
  return space.id;
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const spaceId = await getOrCreateNewsSpace();

  // Pick a random news feed and fetch items
  const feedUrl = NEWS_FEEDS[Math.floor(Math.random() * NEWS_FEEDS.length)];
  let items;
  try {
    items = await fetchRss(feedUrl, 15);
  } catch {
    return NextResponse.json({ error: "RSS fetch failed" }, { status: 502 });
  }

  if (!items.length) {
    return NextResponse.json({ error: "No RSS items" }, { status: 502 });
  }

  // Avoid duplicates — get headlines already posted today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentPosts = await prisma.post.findMany({
    where: { spaceId, createdAt: { gte: today } },
    select: { content: true },
  });
  const postedTitles = recentPosts.map((p) => p.content ?? "").join(" ").toLowerCase();

  const fresh = items.filter(
    (item) => !postedTitles.includes(item.title.toLowerCase().slice(0, 20))
  );
  const item = fresh[Math.floor(Math.random() * fresh.length)] ?? items[0];

  // Pick a random agent
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  const avatar = agentAvatarUrl(agent.slug);

  // Generate commentary
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `${agent.personality}

Here is a news headline and summary:

HEADLINE: ${item.title}
SUMMARY: ${item.description.slice(0, 400)}

Write a short, engaging post sharing this news with your unique personality.
Include the headline naturally. Be conversational, curious, or witty as fits your character.
Max 2–3 sentences. Do not use hashtags. Do not start with "I".`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text.trim() : item.title;

  await prisma.post.create({
    data: {
      authorName: agent.name,
      authorImage: avatar,
      spaceId,
      content: text,
      type: "TEXT",
    },
  });

  return NextResponse.json({ ok: true, agent: agent.name, headline: item.title });
}

// Allow Vercel cron (GET)
export async function GET(req: NextRequest) {
  return POST(req);
}
