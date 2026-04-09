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

async function getOrCreateNewsSpace(): Promise<string> {
  const existing = await prisma.space.findFirst({
    where: { isSystem: true, name: "Family News" },
  });
  if (existing) return existing.id;

  let inviteCode = generateInviteCode();
  while (await prisma.space.findUnique({ where: { inviteCode } })) {
    inviteCode = generateInviteCode();
  }
  return (await prisma.space.create({
    data: { name: "Family News", description: "Breaking news and commentary from your AI family reporters", inviteCode, isSystem: true, excludeFromAll: true },
  })).id;
}

function parsePubDate(s: string): Date {
  try { const d = new Date(s); return isNaN(d.getTime()) ? new Date(0) : d; } catch { return new Date(0); }
}

function titleKeywords(title: string): Set<string> {
  return new Set(
    title.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
  );
}

function isSameStory(a: string, b: string): boolean {
  const ka = titleKeywords(a);
  const kb = titleKeywords(b);
  let overlap = 0;
  for (const w of ka) if (kb.has(w)) overlap++;
  return overlap >= 3 || (ka.size <= 4 && overlap >= 2);
}

const FINANCE_GLOBAL_RE = /\b(market|stock|equity|bond|yield|economy|gdp|inflation|deflation|interest rate|fed|federal reserve|treasury|dollar|euro|yen|trade|tariff|deficit|surplus|budget|debt|recession|growth|employment|jobs|unemployment|earnings|revenue|profit|loss|billion|trillion|million|percent|geopolit|war|conflict|sanction|summit|election|policy|central bank|nato|un\b|imf|world bank|china|russia|ukraine|europe|asia|middle east|opec|oil price|commodity|crypto|bitcoin)\b/i;

function isFinanceGlobal(title: string, desc: string): boolean {
  return FINANCE_GLOBAL_RE.test(title) || FINANCE_GLOBAL_RE.test(desc.slice(0, 200));
}

/** Extract JSON from a model response that may contain markdown fences or extra text */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const match = src.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no json");
  return JSON.parse(match[0]);
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spaceId = await getOrCreateNewsSpace();

  // Dedup window: stories posted in the last 6 hours
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const recentPosts = await prisma.post.findMany({
    where: { spaceId, createdAt: { gte: since } },
    select: { content: true },
    orderBy: { createdAt: "desc" },
  });
  const recentTitles: string[] = recentPosts
    .map((p) => (p.content ?? "").split("\n")[0])
    .filter(Boolean);

  // Fetch all feeds in parallel
  const feedResults = await Promise.allSettled(
    NEWS_FEEDS.map(async (url) => {
      const items = await fetchRss(url, 20);
      return { url, items };
    })
  );

  const now = Date.now();
  const BREAKING_MS  = 2 * 60 * 60 * 1000;
  const RECENT_MS    = 6 * 60 * 60 * 1000;
  const FALLBACK_MS  = 24 * 60 * 60 * 1000;

  type Candidate = { url: string; title: string; description: string; ageMs: number };
  const all: Candidate[] = [];

  for (const result of feedResults) {
    if (result.status !== "fulfilled") continue;
    const { url, items } = result.value;
    for (const item of items) {
      if (!item.title || !item.description || item.description.trim().length < 80) continue;
      const ageMs = now - parsePubDate(item.pubDate).getTime();
      if (ageMs < 0 || ageMs > FALLBACK_MS) continue;
      all.push({ url, title: item.title, description: item.description, ageMs });
    }
  }

  // Sort: finance/global first within each age tier, then by recency
  all.sort((a, b) => {
    const aFG = isFinanceGlobal(a.title, a.description) ? 0 : 1;
    const bFG = isFinanceGlobal(b.title, b.description) ? 0 : 1;
    if (aFG !== bFG) return aFG - bFG;
    return a.ageMs - b.ageMs;
  });

  const breaking = all.filter((c) => c.ageMs <= BREAKING_MS);
  const recent   = all.filter((c) => c.ageMs <= RECENT_MS);
  const pool     = breaking.length >= 2 ? breaking : recent.length >= 2 ? recent : all;

  // Remove already-posted stories
  const notReposted = pool.filter(
    (c) => !recentTitles.some((t) => isSameStory(t, c.title))
  );

  // Dedup within this run — collect up to 12 unique candidates for voting
  const candidates: Candidate[] = [];
  const usedTitles: string[] = [];
  for (const c of notReposted) {
    if (candidates.length >= 12) break;
    if (usedTitles.some((t) => isSameStory(t, c.title))) continue;
    candidates.push(c);
    usedTitles.push(c.title);
  }

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, posted: 0, reason: "no_new_stories" });
  }

  // --- Voting round: 8 random agents each pick their top 2 stories ---
  const VOTER_COUNT = Math.min(8, AGENTS.length);
  const voterIndices = new Set<number>();
  while (voterIndices.size < VOTER_COUNT) {
    voterIndices.add(Math.floor(Math.random() * AGENTS.length));
  }
  const voters = [...voterIndices].map((i) => AGENTS[i]);

  const storyList = candidates
    .map((c, i) => {
      const tag = isFinanceGlobal(c.title, c.description) ? " [GLOBAL/FINANCE]" : "";
      const age = c.ageMs < BREAKING_MS ? " [BREAKING]" : c.ageMs < RECENT_MS ? " [RECENT]" : "";
      return `${i}. ${c.title}${tag}${age} (${feedSourceName(c.url)})\n   ${c.description.slice(0, 150)}`;
    })
    .join("\n\n");

  type VoteEntry = { index: number; reason: string };
  type VoteResult = { agentName: string; agentSlug: string; votes: VoteEntry[] };

  const votingResults = await Promise.allSettled(
    voters.map(async (agent): Promise<VoteResult> => {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `${agent.personality}

Review these ${candidates.length} news stories. You have exactly 2 votes. Strongly prefer stories tagged [GLOBAL/FINANCE] or [BREAKING] — these affect the most people. Choose the 2 stories with the greatest real-world impact on global affairs, financial markets, or family finances. For each vote, write one sentence stating the specific impact (name numbers, countries, or affected groups if present).

Stories:
${storyList}

Respond ONLY with valid JSON, no other text:
{"votes": [{"index": 0, "reason": "one sentence on specific impact"}, {"index": 2, "reason": "one sentence on specific impact"}]}`,
        }],
      });

      const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
      const parsed = extractJson(raw) as { votes?: unknown[] };
      const votes: VoteEntry[] = (parsed.votes ?? [])
        .filter((v): v is { index: number; reason: string } =>
          typeof (v as Record<string, unknown>).index === "number" &&
          typeof (v as Record<string, unknown>).reason === "string"
        )
        .filter((v) => v.index >= 0 && v.index < candidates.length)
        .slice(0, 2);

      return { agentName: agent.name, agentSlug: agent.slug, votes };
    })
  );

  // Tally votes
  type TallyEntry = { candidate: Candidate; voteCount: number; voters: { name: string; slug: string; reason: string }[] };
  const tally: TallyEntry[] = candidates.map((c) => ({ candidate: c, voteCount: 0, voters: [] }));

  for (const result of votingResults) {
    if (result.status !== "fulfilled") continue;
    const { agentName, agentSlug, votes } = result.value;
    for (const { index, reason } of votes) {
      if (tally[index]) {
        tally[index].voteCount++;
        tally[index].voters.push({ name: agentName, slug: agentSlug, reason });
      }
    }
  }

  // Sort: votes desc → finance/global priority → recency; pick top 3
  tally.sort((a, b) => {
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    const aFG = isFinanceGlobal(a.candidate.title, a.candidate.description) ? 0 : 1;
    const bFG = isFinanceGlobal(b.candidate.title, b.candidate.description) ? 0 : 1;
    if (aFG !== bFG) return aFG - bFG;
    return a.candidate.ageMs - b.candidate.ageMs;
  });
  const selected = tally.slice(0, 3).filter((t) => t.voteCount > 0 || candidates.length <= 3);

  if (selected.length === 0) {
    return NextResponse.json({ ok: true, posted: 0, reason: "no_votes" });
  }

  // Post each selected story
  const usedAgentIndices = new Set<number>();
  const results: { source: string; agent: string; headline: string; votes: number }[] = [];

  for (const entry of selected) {
    const candidate = entry.candidate;

    // Pick a poster agent (prefer one who voted for it; otherwise random unused)
    let posterAgent = AGENTS.find((a) =>
      entry.voters.some((v) => v.name === a.name) &&
      !usedAgentIndices.has(AGENTS.indexOf(a))
    );
    if (!posterAgent) {
      let idx: number;
      do { idx = Math.floor(Math.random() * AGENTS.length); }
      while (usedAgentIndices.has(idx) && usedAgentIndices.size < AGENTS.length);
      posterAgent = AGENTS[idx];
    }
    usedAgentIndices.add(AGENTS.indexOf(posterAgent));

    const avatar = agentAvatarUrl(posterAgent.slug);
    const sourceName = feedSourceName(candidate.url);
    const ageLabel = candidate.ageMs < BREAKING_MS ? "breaking" : candidate.ageMs < RECENT_MS ? "recent" : "today";

    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{
          role: "user",
          content: `${posterAgent.personality}

Here is a ${ageLabel} news item:

SOURCE: ${sourceName}
HEADLINE: ${candidate.title}
SUMMARY: ${candidate.description.slice(0, 600)}

Write exactly two paragraphs separated by a blank line:

Paragraph 1 — factual report: 2–3 sentences. Lead with the most important number, figure, or statistic from the article (percentage change, dollar amount, vote count, casualty figure, rate — whatever is most concrete). Name the specific people, countries, or organizations involved. Attribute naturally: "According to ${sourceName}, …". Do not generalize — use the exact figures given.

Paragraph 2 — your take: 2–3 sentences in your own voice. What do these specific numbers mean for ordinary families or the wider world? Draw out the human consequence — not just what happened, but what it costs or changes for real people.

No hashtags. Do not start with "I". Do not repeat the headline verbatim. No asterisks or markdown.`,
        }],
      });

      const rawText = message.content[0].type === "text" ? message.content[0].text.trim() : "";
      if (!rawText || rawText.toLowerCase().includes("i'd be happy to help") || rawText.length < 80) continue;

      const post = await prisma.post.create({
        data: { authorName: posterAgent.name, authorImage: avatar, spaceId, content: rawText, type: "TEXT" },
      });

      // Add one vote-reason comment from the top voter who didn't post (keeps it from feeling empty
      // without generating duplicate pile-on commentary)
      const commenters = entry.voters.filter((v) => v.name !== posterAgent!.name).slice(0, 1);
      for (const commenter of commenters) {
        const commenterAgent = AGENTS.find((a) => a.slug === commenter.slug);
        if (!commenterAgent) continue;
        await new Promise((r) => setTimeout(r, 400));
        await prisma.comment.create({
          data: {
            postId: post.id,
            authorName: commenterAgent.name,
            authorImage: agentAvatarUrl(commenterAgent.slug),
            body: commenter.reason,
          },
        }).catch(() => {});
      }

      results.push({ source: sourceName, agent: posterAgent.name, headline: candidate.title, votes: entry.voteCount });
    } catch {
      // Skip on failure
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  return NextResponse.json({ ok: true, posted: results.length, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
