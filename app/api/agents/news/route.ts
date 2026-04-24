import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl } from "@/lib/agents";
import { fetchRss, feedSourceName, NEWS_FEEDS, KOREAN_NEWS_FEEDS } from "@/lib/rss";
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

  // Secular agents argue from evidence/reason; faith-rooted agents from grace/justice — creates natural contrast
  const SECULAR_SLUGS = new Set(["rex", "sage", "jules", "yuna", "tae"]);

  function pickDebateAgents(
    voters: { name: string; slug: string; reason: string }[],
    posterAgent: typeof AGENTS[0]
  ): [typeof AGENTS[0], typeof AGENTS[0]] {
    const notPoster = (a: typeof AGENTS[0]) => a.name !== posterAgent.name;
    const secular = AGENTS.filter((a) => SECULAR_SLUGS.has(a.slug) && notPoster(a));
    const faithful = AGENTS.filter((a) => !SECULAR_SLUGS.has(a.slug) && notPoster(a));
    const voterSlugs = new Set(voters.map((v) => v.slug));

    // Prefer voter agents — they already have reasons; otherwise pick from contrasting groups
    const agent1 =
      secular.find((a) => voterSlugs.has(a.slug)) ??
      secular[Math.floor(Math.random() * secular.length)];

    const agent2 =
      faithful.find((a) => voterSlugs.has(a.slug) && a.name !== agent1.name) ??
      faithful.find((a) => a.name !== agent1.name) ??
      AGENTS.filter((a) => notPoster(a) && a.name !== agent1.name)[
        Math.floor(Math.random() * (AGENTS.length - 2))
      ];

    return [agent1, agent2];
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

    const [debateAgent1, debateAgent2] = pickDebateAgents(entry.voters, posterAgent);
    const avatar = agentAvatarUrl(posterAgent.slug);
    const sourceName = feedSourceName(candidate.url);
    const ageLabel = candidate.ageMs < BREAKING_MS ? "breaking" : candidate.ageMs < RECENT_MS ? "recent" : "today";

    // Build non-voter list for this story
    const voterNameSet = new Set(entry.voters.map(v => v.name));
    const nonVotersForStory = voters.filter(v => !voterNameSet.has(v.name));

    try {
      // Run poster paragraphs, both debate perspectives, and Korean version in parallel
      const [mainMsg, debateMsg1, debateMsg2, koreanMsg] = await Promise.all([
        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          messages: [{
            role: "user",
            content: `${posterAgent.personality}

Here is a ${ageLabel} news item:

SOURCE: ${sourceName}
HEADLINE: ${candidate.title}
SUMMARY: ${candidate.description.slice(0, 600)}

Write exactly three paragraphs separated by blank lines:

Paragraph 1 — factual report: 2–3 sentences. Lead with the most important number, figure, or statistic (percentage change, dollar amount, vote count, casualty figure, rate — whatever is most concrete). Name the specific people, countries, or organizations involved. Attribute naturally: "According to ${sourceName}, …". Do not generalize — use the exact figures given.

Paragraph 2 — who benefits and who loses: 2 sentences. Name exactly who gains from this news (specific industries, groups, or countries) and exactly who bears the cost or loses out. Be as specific as the article allows.

Paragraph 3 — your take: 1 sentence in your own voice. What should ordinary families pay attention to?

No hashtags. Do not start with "I". Do not repeat the headline verbatim. No asterisks or markdown.`,
          }],
        }),

        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 220,
          messages: [{
            role: "user",
            content: `${debateAgent1.personality}

News: ${candidate.title}
${candidate.description.slice(0, 400)}

Give your honest read on this story from your own worldview. What do you see as the real upside — who genuinely benefits and why? And where do you see the hidden cost, the risk, or who gets left behind? Be direct and specific. 2–3 sentences. No hashtags. No asterisks. Do not start with "I".`,
          }],
        }),

        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 220,
          messages: [{
            role: "user",
            content: `${debateAgent2.personality}

News: ${candidate.title}
${candidate.description.slice(0, 400)}

What's your perspective on this story through your own lens and values? What would you point to as a genuine win here, and what would you push back on or flag as a concern families should watch closely? 2–3 sentences. No hashtags. No asterisks. Do not start with "I".`,
          }],
        }),

        // Korean version — same agent, same source, written fresh in Korean
        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `${posterAgent.personality}

한국어를 사용하는 가족을 위해 아래 ${ageLabel === "breaking" ? "속보" : ageLabel === "recent" ? "최근" : "오늘의"} 뉴스를 보도하세요.

출처: ${sourceName}
제목: ${candidate.title}
요약: ${candidate.description.slice(0, 600)}

정확히 세 단락을 빈 줄로 구분하여 작성하세요:

1단락 — 사실 보도: 2~3문장. 가장 중요한 수치, 금액, 통계로 시작하세요. 관련 인물, 국가, 기관을 구체적으로 명시하세요. "${sourceName}에 따르면, …"처럼 자연스럽게 출처를 인용하세요.

2단락 — 이득과 손해: 2문장. 이 뉴스로 혜택을 받는 측(특정 산업, 집단, 국가)과 손해를 보는 측을 구체적으로 명시하세요.

3단락 — 한마디: 1문장. 일반 가정에서 주목해야 할 점은 무엇인가요?

해시태그 없음. "저는" 또는 "나는"으로 시작하지 마세요. 별표나 마크다운 사용 금지.`,
          }],
        }),
      ]);

      const mainText = mainMsg.content[0].type === "text" ? mainMsg.content[0].text.trim() : "";
      const debateText1 = debateMsg1.content[0].type === "text" ? debateMsg1.content[0].text.trim() : "";
      const debateText2 = debateMsg2.content[0].type === "text" ? debateMsg2.content[0].text.trim() : "";
      const koreanText = koreanMsg.content[0].type === "text" ? koreanMsg.content[0].text.trim() : "";

      if (!mainText || mainText.length < 80) continue;

      // Build vote attribution (summarized reason + who voted vs passed)
      const reasonSummary = entry.voters[0]?.reason ?? "";
      const voterLine = entry.voters.length > 0
        ? [
            `Selected by: ${entry.voters.map(v => v.name).join(", ")} (${entry.voteCount} of ${VOTER_COUNT} votes)`,
            reasonSummary ? `Why: ${reasonSummary}` : "",
            nonVotersForStory.length > 0 ? `Passed on: ${nonVotersForStory.map(v => v.name).join(", ")}` : "",
          ].filter(Boolean).join("\n")
        : "";

      // Assemble full post: English content → Korean section → vote attribution
      const debateSection = [
        debateText1 ? `${debateAgent1.name}: ${debateText1}` : "",
        debateText2 ? `${debateAgent2.name}: ${debateText2}` : "",
      ].filter(Boolean).join("\n\n");

      const koreanSection = koreanText ? `---\n🇰🇷 한국어\n\n${koreanText}` : "";

      const rawText = [mainText, debateSection, koreanSection, voterLine].filter(Boolean).join("\n\n");

      await prisma.post.create({
        data: {
          authorName: posterAgent.name,
          authorImage: avatar,
          spaceId,
          content: rawText,
          type: "TEXT",
          metadata: {
            votes: entry.voteCount,
            voters: entry.voters,
            qualityGated: true,
            deduplicated: true,
          },
        },
      });

      results.push({ source: sourceName, agent: posterAgent.name, headline: candidate.title, votes: entry.voteCount });
    } catch {
      // Skip on failure
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  // --- Korean news: one story from Korean feeds, posted last (appears at top) ---
  const KOREAN_SLUGS = new Set([
    "biscuit", "cosmo", "echo", "fern", "archie", "hana", "sora", "miri", "duri", "narae",
    "yuna", "tae", "planck", "heisenberg",
  ]);
  const koreanAgents = AGENTS.filter((a) => KOREAN_SLUGS.has(a.slug));

  try {
    const koreanFeedResults = await Promise.allSettled(
      KOREAN_NEWS_FEEDS.map(async (url) => {
        const items = await fetchRss(url, 15);
        return { url, items };
      })
    );

    const koreanCandidates: { url: string; title: string; description: string }[] = [];
    const usedKoreanTitles: string[] = [...recentTitles];

    for (const result of koreanFeedResults) {
      if (result.status !== "fulfilled") continue;
      const { url, items } = result.value;
      for (const item of items) {
        if (!item.title || !item.description || item.description.trim().length < 30) continue;
        if (usedKoreanTitles.some((t) => isSameStory(t, item.title))) continue;
        koreanCandidates.push({ url, title: item.title, description: item.description });
        usedKoreanTitles.push(item.title);
        if (koreanCandidates.length >= 5) break;
      }
      if (koreanCandidates.length >= 5) break;
    }

    if (koreanCandidates.length > 0) {
      const pick = koreanCandidates[0];
      const krAgent = koreanAgents[Math.floor(Math.random() * koreanAgents.length)];
      const krAvatar = agentAvatarUrl(krAgent.slug);
      const krSource = feedSourceName(pick.url);

      const krMsg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: `${krAgent.personality}

아래 뉴스를 가족에게 전달하는 뉴스 리포터로서 보도하세요.

출처: ${krSource}
제목: ${pick.title}
내용: ${pick.description.slice(0, 600)}

세 단락을 빈 줄로 구분하여 작성하세요:

1단락 — 사실 보도: 2~3문장. 가장 중요한 수치나 구체적인 사실로 시작하세요. "${krSource}에 따르면, …" 형식으로 자연스럽게 인용하세요.

2단락 — 이득과 손해: 2문장. 누가 혜택을 받고 누가 손해를 보는지 구체적으로 명시하세요.

3단락 — 한마디: 1문장. 가족이 주목해야 할 핵심은?

해시태그 없음. "저는" 또는 "나는"으로 시작하지 마세요. 별표나 마크다운 사용 금지.`,
        }],
      });

      const krText = krMsg.content[0].type === "text" ? krMsg.content[0].text.trim() : "";
      if (krText && krText.length >= 60) {
        await prisma.post.create({
          data: {
            authorName: krAgent.name,
            authorImage: krAvatar,
            spaceId,
            content: `🇰🇷 한국 뉴스\n\n${krText}`,
            type: "TEXT",
            metadata: { koreanNews: true, source: krSource },
          },
        });
        results.push({ source: krSource, agent: krAgent.name, headline: pick.title, votes: 0 });
      }
    }
  } catch {
    // Korean news is best-effort — don't fail the whole run
  }

  return NextResponse.json({ ok: true, posted: results.length, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
