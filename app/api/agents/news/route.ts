import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";
import { recordHeartbeat } from "@/lib/aiCallLog";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl, FAITH_GUARDRAIL } from "@/lib/agents";
import { fetchRss, type RssItem } from "@/lib/rss";
import { GLOBAL_SOURCES, KOREAN_SOURCES, pickBalanced, type Lean, type NewsSource } from "@/lib/newsSources";
import { generateInviteCode } from "@/lib/invite";
import { isCronAuthorized } from "@/lib/cronAuth";
import { authOptions } from "@/lib/auth";
import { finalizeAgentText } from "@/lib/agentText";
import { fetchArticleText } from "@/lib/articleText";
import {
  assembleNewsPost, briefIsUsable, briefPrompt, cleanFeedLink, cleanFeedText, clip, dropUnfinishedLine, godViewPrompt,
  headlineOfPost, humanViewPrompt, isSameStory, KOREAN_NEWS_BADGE, koreanPickPrompt, MIN_VOTES_TO_POST, parseBrief,
  parsePick, toHumanView, toPerspective,
  type Brief, type NewsLang, type NewsStory,
} from "@/lib/newsFormat";

type Agent = (typeof AGENTS)[number];
/** `lean` only balances the candidate list (see lib/newsSources.ts); it never reaches a prompt or a post. */
type Candidate = NewsStory & { ageMs: number; lean: Lean };
type Voter = { name: string; slug: string; reason: string };
type Posted = { source: string; agent: string; headline: string; votes: number };
/** Saves a post — or, in a dry run, just collects it. */
type Publish = (author: Agent, content: string, metadata: Prisma.InputJsonObject) => Promise<void>;
/** What each feed returned, reported by a dry run — a feed that silently stops working is otherwise invisible. */
type FeedReport = { feed: string; ok: boolean; items: number; error?: string; note?: string };

/** A feed that fails is skipped, never fatal: the run goes on with the feeds that answered. */
async function loadFeed(source: NewsSource, limit: number, reports: FeedReport[]): Promise<{ source: NewsSource; items: RssItem[]; report: FeedReport }> {
  const feed = `${source.name} — ${source.url}`;
  let report: FeedReport;
  let items: RssItem[] = [];
  try {
    items = await fetchRss(source.url, limit);
    report = { feed, ok: true, items: items.length };
  } catch (err) {
    report = { feed, ok: false, items: 0, error: err instanceof Error ? err.message : String(err) };
  }
  reports.push(report);
  return { source, items, report };
}

/** A picked story with the other outlets' reports of the same event attached. */
function withOthers<T extends NewsStory>(pick: { story: T; others: T[] }): T {
  return { ...pick.story, others: pick.others.map((o) => ({ sourceName: o.sourceName, link: o.link, description: o.description })) };
}

const BREAKING_MS = 2 * 60 * 60 * 1000;
const RECENT_MS = 6 * 60 * 60 * 1000;
const FALLBACK_MS = 24 * 60 * 60 * 1000;
/** Stories are taken from the last 24h of the feeds, so the "already posted" check looks back just as far. */
const DEDUP_WINDOW_MS = FALLBACK_MS;

/** Fewer candidates and more voters than before, so the votes concentrate and a real consensus can form. */
const MAX_CANDIDATES = 8;
const VOTER_COUNT = Math.min(6, AGENTS.length);
const MAX_STORIES_PER_RUN = 3;
/** How many fresh Korean stories the pick call chooses from. */
const KOREAN_PICK_POOL = 15;

/**
 * Every agent is a Christian. The evidence-to-faith agents write the human-standards view
 * (they came to Christ by weighing arguments); the others write the God-centered view.
 */
const EVIDENCE_LENS_SLUGS = new Set(["rex", "sage", "jules", "yuna", "tae"]);
const KOREAN_SLUGS = new Set([
  "biscuit", "cosmo", "echo", "fern", "archie", "hana", "sora", "miri", "duri", "narae",
  "yuna", "tae", "planck", "heisenberg",
]);

const pickRandom = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/** `create: false` (dry run) only looks the space up, so a dry run never writes anything. */
async function getNewsSpace(create: boolean): Promise<string | null> {
  const existing = await prisma.space.findFirst({
    where: { isSystem: true, name: "Family News" },
  });
  if (existing) return existing.id;
  if (!create) return null;

  let inviteCode = generateInviteCode();
  while (await prisma.space.findUnique({ where: { inviteCode } })) {
    inviteCode = generateInviteCode();
  }
  return (await prisma.space.create({
    data: { name: "Family News", description: "Breaking news and commentary from your AI family reporters", inviteCode, isSystem: true, excludeFromAll: true },
  })).id;
}

function parsePubDate(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
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

function isVote(v: unknown): v is { index: number; reason: string } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>; // a non-null object from model JSON, read field by field
  return typeof o.index === "number" && typeof o.reason === "string";
}

/** `shape: "lines"` is the labelled brief; `"prose"` is a perspective, trimmed to its last full sentence if cut off. */
async function ask(label: string, agent: Agent, prompt: string, maxTokens: number, shape: "lines" | "prose"): Promise<string> {
  const msg = await anthropicFor(label, agent.name).messages.create({
    ...AGENT_REQUEST,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return shape === "lines"
    ? finalizeAgentText(dropUnfinishedLine(textOf(msg), msg.stop_reason))
    : finalizeAgentText(textOf(msg), msg.stop_reason);
}

/**
 * Writes one news post: the factual brief (TL;DR + who/what/when/where/why/how, from the source
 * only), then the God-centered view, then the human-standards view. `langs: "both"` is the
 * English + Korean layout; `"ko"` is the Korean-feed story. Returns null when the brief the post
 * needs could not be produced — a news post without its facts is not posted.
 */
async function composeStory(o: {
  story: NewsStory;
  reporter: Agent;
  godAgent: Agent;
  humanAgent: Agent;
  langs: "both" | "ko";
  badge?: string;
  footer?: string;
}): Promise<string | null> {
  const both = o.langs === "both";
  const [enRaw, koRaw, godRaw, humanRaw] = await Promise.allSettled([
    // Budgets leave room for the Korean half: Korean costs roughly twice the tokens of the same
    // sentence in English, and a cut-off reply loses its last line ("정리:").
    both ? ask("news:report", o.reporter, briefPrompt("en", o.story), 800, "lines") : Promise.resolve(""),
    ask(both ? "news:reportKorean" : "news:koreanFeed", o.reporter, briefPrompt("ko", o.story), 1300, "lines"),
    ask("news:godView", o.godAgent, godViewPrompt(o.godAgent, o.story, o.langs, FAITH_GUARDRAIL), both ? 800 : 500, "prose"),
    ask("news:humanView", o.humanAgent, humanViewPrompt(o.humanAgent, o.story, o.langs, FAITH_GUARDRAIL), both ? 900 : 600, "prose"),
  ]);
  const text = (r: PromiseSettledResult<string>) => (r.status === "fulfilled" ? r.value : "");
  const brief = (lang: NewsLang, raw: string): Brief | null => {
    const b = parseBrief(lang, raw);
    return briefIsUsable(b) ? b : null;
  };

  const en = both ? brief("en", text(enRaw)) : null;
  const ko = brief("ko", text(koRaw));
  if (both ? !en : !ko) return null;

  return assembleNewsPost({
    story: o.story,
    badge: o.badge,
    en,
    ko,
    godView: toPerspective(o.godAgent.name, text(godRaw), o.langs),
    humanView: toHumanView(o.humanAgent.name, text(humanRaw), o.langs),
    footer: o.footer,
  });
}

async function withArticleText<T extends NewsStory>(story: T): Promise<T> {
  if (!story.link) return story;
  return { ...story, articleText: await fetchArticleText(story.link, story.title) };
}

/**
 * `taken` holds the agents who already wrote a perspective in this run, so three stories don't
 * all carry the same two voices; it is updated here.
 */
function pickPerspectiveAgents(voters: Voter[], reporter: Agent, taken: Set<string>): { godAgent: Agent; humanAgent: Agent } {
  const others = AGENTS.filter((a) => a.name !== reporter.name);
  const voterSlugs = new Set(voters.map((v) => v.slug));
  const choose = (lens: Agent[]): Agent => {
    const fresh = lens.filter((a) => !taken.has(a.name));
    const from = fresh.length > 0 ? fresh : lens;
    // Prefer agents who voted for the story — they already chose to engage with it.
    const agent = from.find((a) => voterSlugs.has(a.slug)) ?? pickRandom(from);
    taken.add(agent.name);
    return agent;
  };
  return {
    godAgent: choose(others.filter((a) => !EVIDENCE_LENS_SLUGS.has(a.slug))),
    humanAgent: choose(others.filter((a) => EVIDENCE_LENS_SLUGS.has(a.slug))),
  };
}

type VotedOutcome = { results: Posted[]; reason?: string; tally: { title: string; votes: number }[] };

/** Global stories: agents vote, and only stories at least MIN_VOTES_TO_POST of them chose are posted. */
async function postVotedStories(recentHeadlines: string[], publish: Publish, reports: FeedReport[]): Promise<VotedOutcome> {
  const feeds = await Promise.all(GLOBAL_SOURCES.map((source) => loadFeed(source, 20, reports)));

  const now = Date.now();
  const all: Candidate[] = [];
  for (const { source, items, report } of feeds) {
    let usable = 0;
    for (const item of items) {
      const title = cleanFeedText(item.title);
      const description = cleanFeedText(item.description);
      const publishedAt = parsePubDate(item.pubDate);
      if (!title || description.length < 80 || !publishedAt) continue;
      const ageMs = now - publishedAt.getTime();
      if (ageMs < 0 || ageMs > FALLBACK_MS) continue;
      usable++;
      all.push({ sourceName: source.name, lean: source.lean, title, description, link: cleanFeedLink(item.link), publishedAt, ageMs });
    }
    if (items.length > 0) report.note = `${usable} usable (dated within 24h, with a summary)`;
  }

  // Sort: finance/global first within each age tier, then by recency
  all.sort((a, b) => {
    const aFG = isFinanceGlobal(a.title, a.description) ? 0 : 1;
    const bFG = isFinanceGlobal(b.title, b.description) ? 0 : 1;
    if (aFG !== bFG) return aFG - bFG;
    return a.ageMs - b.ageMs;
  });

  const breaking = all.filter((c) => c.ageMs <= BREAKING_MS);
  const recent = all.filter((c) => c.ageMs <= RECENT_MS);
  const pool = breaking.length >= 2 ? breaking : recent.length >= 2 ? recent : all;

  // Drop already-posted stories, then spread the candidates across outlets and leanings; reports
  // of the same event by several outlets become one candidate that cites them all.
  const fresh = pool.filter((c) => !recentHeadlines.some((t) => isSameStory(t, c.title)));
  const candidates: Candidate[] = pickBalanced(fresh, MAX_CANDIDATES).map(withOthers);
  if (candidates.length === 0) return { results: [], reason: "no_new_stories", tally: [] };

  // --- Voting round: VOTER_COUNT random agents each pick their top 2 stories ---
  const voters = [...AGENTS].sort(() => Math.random() - 0.5).slice(0, VOTER_COUNT);

  const storyList = candidates
    .map((c, i) => {
      const tag = isFinanceGlobal(c.title, c.description) ? " [GLOBAL/FINANCE]" : "";
      const age = c.ageMs < BREAKING_MS ? " [BREAKING]" : c.ageMs < RECENT_MS ? " [RECENT]" : "";
      const outlets = [c.sourceName, ...(c.others ?? []).map((o) => o.sourceName)];
      const shared = outlets.length > 1 ? ` [${outlets.length} OUTLETS]` : "";
      return `${i}. ${c.title}${tag}${age}${shared} (${outlets.join(", ")})\n   ${c.description.slice(0, 150)}`;
    })
    .join("\n\n");

  type Ballot = { agent: Agent; votes: { index: number; reason: string }[] };

  const ballotResults = await Promise.allSettled(
    voters.map(async (agent): Promise<Ballot> => {
      const msg = await anthropicFor("news:vote", agent.name).messages.create({
        ...AGENT_REQUEST,
        max_tokens: 390,
        messages: [{
          role: "user",
          content: `${agent.personality}

Review these ${candidates.length} news stories. You have exactly 2 votes, for two different stories.

Judge each story on all four criteria and vote for the 2 that score best overall:

1. Global significance — Does this affect people, economies, or governments across multiple countries, not just one?
2. Audience sympathy — Can most ordinary people relate to this, feel the stakes, or be genuinely moved by it?
3. Critical importance — Is this urgent, high-stakes, or likely to have lasting real-world consequences?
4. Novelty — Is this genuinely new information, not a story that has been unfolding for weeks already?

Prefer stories tagged [GLOBAL/FINANCE] or [BREAKING], and stories that several outlets are reporting. Skip anything that feels like background noise or a recurring slow-burn story.

Stories:
${storyList}

Respond ONLY with valid JSON, no other text:
{"votes": [{"index": 0, "reason": "one sentence on which criteria it meets"}, {"index": 2, "reason": "one sentence on which criteria it meets"}]}`,
        }],
      });

      const parsed = extractJson(textOf(msg) || "{}") as { votes?: unknown }; // model JSON: every field is checked below
      const seen = new Set<number>();
      const votes = (Array.isArray(parsed.votes) ? parsed.votes : [])
        .filter(isVote)
        .filter((v) => Number.isInteger(v.index) && v.index >= 0 && v.index < candidates.length)
        // One voter, one vote per story: naming the same story twice must not count as two.
        .filter((v) => (seen.has(v.index) ? false : (seen.add(v.index), true)))
        .slice(0, 2);

      return { agent, votes };
    })
  );
  const ballots = ballotResults.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

  // Tally votes
  const tally = candidates.map((candidate) => ({ candidate, voters: [] as Voter[] }));
  for (const { agent, votes } of ballots) {
    for (const { index, reason } of votes) tally[index].voters.push({ name: agent.name, slug: agent.slug, reason });
  }

  // Sort: votes desc → finance/global priority → recency
  tally.sort((a, b) => {
    if (b.voters.length !== a.voters.length) return b.voters.length - a.voters.length;
    const aFG = isFinanceGlobal(a.candidate.title, a.candidate.description) ? 0 : 1;
    const bFG = isFinanceGlobal(b.candidate.title, b.candidate.description) ? 0 : 1;
    if (aFG !== bFG) return aFG - bFG;
    return a.candidate.ageMs - b.candidate.ageMs;
  });
  const tallySummary = tally.map((t) => ({ title: t.candidate.title, votes: t.voters.length }));

  // A story needs real agreement. One agent's pick is not a selection, so a run with no
  // story at the threshold posts nothing and waits for the next round.
  const selected = tally.slice(0, MAX_STORIES_PER_RUN).filter((t) => t.voters.length >= MIN_VOTES_TO_POST);
  if (selected.length === 0) return { results: [], reason: "no_consensus", tally: tallySummary };

  const stories = await Promise.all(selected.map((t) => withArticleText(t.candidate)));

  const usedReporters = new Set<string>();
  const usedPerspectiveAgents = new Set<string>();
  const results: Posted[] = [];

  for (const [i, entry] of selected.entries()) {
    const story = stories[i];
    const voteCount = entry.voters.length;

    // Reporter: prefer an agent who voted for the story and hasn't reported yet in this run
    const reporter =
      AGENTS.find((a) => !usedReporters.has(a.name) && entry.voters.some((v) => v.name === a.name)) ??
      pickRandom(AGENTS.filter((a) => !usedReporters.has(a.name)));
    usedReporters.add(reporter.name);
    const { godAgent, humanAgent } = pickPerspectiveAgents(entry.voters, reporter, usedPerspectiveAgents);

    const votedFor = new Set(entry.voters.map((v) => v.name));
    const passed = ballots.filter((b) => !votedFor.has(b.agent.name)).map((b) => b.agent.name);
    const footer = [
      `🗳️ Selected by: ${entry.voters.map((v) => v.name).join(", ")} (${voteCount} of ${ballots.length} voters)`,
      entry.voters[0]?.reason ? `Why: ${clip(entry.voters[0].reason, 200)}` : "",
      passed.length > 0 ? `Passed on: ${passed.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    try {
      const content = await composeStory({ story, reporter, godAgent, humanAgent, langs: "both", footer });
      if (!content) continue;
      await publish(reporter, content, {
        votes: voteCount,
        voters: entry.voters,
        qualityGated: true,
        deduplicated: true,
        source: story.sourceName,
        ...(story.link ? { link: story.link } : {}),
        ...(story.others?.length ? { alsoReportedBy: story.others.map((o) => o.sourceName) } : {}),
      });
      results.push({ source: story.sourceName, agent: reporter.name, headline: story.title, votes: voteCount });
    } catch {
      // Skip this story on failure; the others still post
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { results, tally: tallySummary };
}

/** One story from the Korean feeds, written in Korean only. Best effort — never fails the run. */
async function postKoreanStory(recentHeadlines: string[], publish: Publish, reports: FeedReport[]): Promise<Posted | null> {
  try {
    const feeds = await Promise.all(KOREAN_SOURCES.map((source) => loadFeed(source, 30, reports)));

    const now = Date.now();
    const perFeed = feeds.map(({ source, items, report }) => {
      let tooShort = 0;
      let alreadyPosted = 0;
      let old = 0;
      const stories: (NewsStory & { lean: Lean })[] = [];
      for (const item of items) {
        const title = cleanFeedText(item.title);
        const description = cleanFeedText(item.description);
        const publishedAt = parsePubDate(item.pubDate);
        if (!title || description.length < 30) { tooShort++; continue; }
        if (publishedAt && now - publishedAt.getTime() > FALLBACK_MS) { old++; continue; }
        if (recentHeadlines.some((t) => isSameStory(t, title))) { alreadyPosted++; continue; }
        stories.push({ sourceName: source.name, lean: source.lean, title, description, link: cleanFeedLink(item.link), publishedAt });
      }
      if (items.length > 0) report.note = `${tooShort} without a usable summary, ${old} older than a day, ${alreadyPosted} already posted`;
      return stories;
    });
    // Newest of every outlet first, then each outlet's second story, and so on — so the wire
    // service that publishes most often doesn't fill the whole list.
    const interleaved: (NewsStory & { lean: Lean })[] = [];
    for (let i = 0; perFeed.some((stories) => i < stories.length); i++) {
      for (const stories of perFeed) if (i < stories.length) interleaved.push(stories[i]);
    }
    const pool: NewsStory[] = pickBalanced(interleaved, KOREAN_PICK_POOL).map(withOthers);
    if (pool.length === 0) return null;

    const koreanAgents = AGENTS.filter((a) => KOREAN_SLUGS.has(a.slug));
    const reporter = pickRandom(koreanAgents.filter((a) => !EVIDENCE_LENS_SLUGS.has(a.slug)));
    const humanAgent = pickRandom(koreanAgents.filter((a) => EVIDENCE_LENS_SLUGS.has(a.slug)));

    // The feed's first item is whatever came in last, often a company filing. Choose the story
    // that matters; if the call fails or finds nothing worth telling, skip this round.
    const pickMsg = await anthropicFor("news:koreanPick", reporter.name).messages.create({
      ...AGENT_REQUEST,
      max_tokens: 10,
      messages: [{ role: "user", content: koreanPickPrompt(pool) }],
    });
    const picked = parsePick(textOf(pickMsg), pool.length);
    reports.push({ feed: "korean pick", ok: picked !== null, items: pool.length, note: picked === null ? "nothing worth posting" : pool[picked].title });
    if (picked === null) return null;
    const pick = pool[picked];

    const story = await withArticleText(pick);
    const content = await composeStory({ story, reporter, godAgent: reporter, humanAgent, langs: "ko", badge: KOREAN_NEWS_BADGE });
    if (!content) return null;

    await publish(reporter, content, { koreanNews: true, source: story.sourceName, ...(story.link ? { link: story.link } : {}) });
    return { source: story.sourceName, agent: reporter.name, headline: story.title, votes: 0 };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const cronAuthorized = isCronAuthorized(req);
  if (!cronAuthorized) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Dry run (cron secret only): runs the whole pipeline and returns the posts instead of saving
  // them, so the format can be checked against live feeds without touching the family's feed.
  const dry = cronAuthorized && req.nextUrl.searchParams.get("dry") === "1";

  // Heartbeat for the admin AI-health dashboard: proves the cron is actually firing.
  if (!dry) {
    if (cronAuthorized) await recordHeartbeat("news", "cron");
    else void recordHeartbeat("news", "user"); // don't delay a user-triggered run
  }

  const spaceId = await getNewsSpace(!dry);
  if (!spaceId) return NextResponse.json({ ok: true, dry: true, posted: 0, results: [], reason: "no_news_space", posts: [] });

  const recentPosts = await prisma.post.findMany({
    where: { spaceId, createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) } },
    select: { content: true },
    orderBy: { createdAt: "desc" },
  });
  const recentHeadlines = recentPosts.map((p) => headlineOfPost(p.content ?? "")).filter(Boolean);

  const preview: { agent: string; content: string }[] = [];
  const publish: Publish = async (author, content, metadata) => {
    if (dry) {
      preview.push({ agent: author.name, content });
      return;
    }
    await prisma.post.create({
      data: { authorName: author.name, authorImage: agentAvatarUrl(author.slug), spaceId, content, type: "TEXT", metadata },
    });
  };

  const feedReports: FeedReport[] = [];
  const voted = await postVotedStories(recentHeadlines, publish, feedReports);
  // Posted last so it appears at the top of the space
  const korean = await postKoreanStory(recentHeadlines, publish, feedReports);
  const results = korean ? [...voted.results, korean] : voted.results;

  return NextResponse.json({
    ok: true,
    posted: dry ? 0 : results.length,
    results,
    ...(voted.reason ? { reason: voted.reason } : {}),
    ...(dry ? { dry: true, tally: voted.tally, feeds: feedReports, posts: preview } : {}),
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
