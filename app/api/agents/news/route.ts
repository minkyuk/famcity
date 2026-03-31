import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl } from "@/lib/agents";
import { fetchRss, feedSourceName, NEWS_FEEDS } from "@/lib/rss";
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

  // Avoid duplicates — get headlines already posted today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentPosts = await prisma.post.findMany({
    where: { spaceId, createdAt: { gte: today } },
    select: { content: true },
  });
  const postedTitles = recentPosts.map((p) => p.content ?? "").join(" ").toLowerCase();

  // Post one item from each of the 4 news sources, each with a different random agent
  const results: { source: string; agent: string; headline: string }[] = [];
  const usedAgentIndices = new Set<number>();

  // Shuffle feed order so sources appear in different order each run
  const shuffledFeeds = [...NEWS_FEEDS].sort(() => Math.random() - 0.5);

  for (const feedUrl of shuffledFeeds) {
    let items;
    try {
      items = await fetchRss(feedUrl, 15);
    } catch {
      continue; // skip this source if RSS fetch fails
    }
    if (!items.length) continue;

    const fresh = items.filter(
      (item) => !postedTitles.includes(item.title.toLowerCase().slice(0, 20))
    );
    const item = fresh[Math.floor(Math.random() * fresh.length)] ?? items[0];

    // Pick a unique agent for each source
    let agentIdx: number;
    do {
      agentIdx = Math.floor(Math.random() * AGENTS.length);
    } while (usedAgentIndices.has(agentIdx) && usedAgentIndices.size < AGENTS.length);
    usedAgentIndices.add(agentIdx);

    const agent = AGENTS[agentIdx];
    const avatar = agentAvatarUrl(agent.slug);

    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: `${agent.personality}

Here is a news item:

SOURCE: ${feedSourceName(feedUrl)}
HEADLINE: ${item.title}
SUMMARY: ${item.description.slice(0, 500)}

Write a post with exactly two paragraphs separated by a blank line:

Paragraph 1 — factual summary: State the essential facts only (who, what, where, when, why, how). Attribute it naturally, e.g. "According to [source], …". Use only information from the summary above — do not invent details. 2–3 sentences. If this is financial or market news, include key numbers, percentages, or market moves mentioned.

Paragraph 2 — your take: In your own voice and personality, give one honest reaction, reflection, or question. For financial news, comment on what it might mean for ordinary people, families, or the broader economy. For world events, reflect on the human dimension. Keep faith references light unless the topic genuinely calls for it. 1–2 sentences.

No hashtags. Do not start with "I".`,
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

      results.push({ source: feedUrl, agent: agent.name, headline: item.title });
      // Mark this headline as seen to avoid same-source duplicates within this run
      postedTitles.concat(" " + item.title.toLowerCase());
    } catch {
      // Skip this source if AI or DB fails
    }

    // Small delay between AI calls to avoid rate limits
    await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json({ ok: true, posted: results.length, results });
}

// Allow Vercel cron (GET)
export async function GET(req: NextRequest) {
  return POST(req);
}
