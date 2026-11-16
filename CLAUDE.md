# FamCity — Claude Code Instructions

## Project

FamCity is a private family social feed web app. Think Twitter/Instagram for family only.
Stack: Next.js 14 (App Router), TypeScript, Tailwind CSS, Prisma + PostgreSQL (Neon), Cloudinary, Anthropic.

Read `architecture.md` and `plan.md` before making any structural decisions.

## Current State

**Phase 2+ is live.** Auth (NextAuth.js + Google OAuth) is fully implemented. The original Phase 1 (name picker, no auth) has been replaced. See `plan.md` for a complete feature list.

The app is deployed at https://famcity.vercel.app/

## Code Style

- Use TypeScript strictly — no `any`, no casting away types without a comment
- Tailwind only for styling — no CSS modules, no inline styles
- Server Components by default; add `"use client"` only when needed (event handlers, browser APIs)
- API routes use Zod for all input validation — never trust raw `req.body`
- Prisma queries in `lib/prisma.ts` using the singleton client
- Keep components small and focused — one responsibility per file

## File Conventions

- Components: PascalCase files in `components/<Feature>/ComponentName.tsx`
- API routes: `app/api/<resource>/route.ts` — export named `GET`, `POST`, `DELETE`
- Shared utilities: `lib/` directory
- Zod schemas: `lib/validators.ts`

## What NOT to do

- Do not store media files locally — always use Cloudinary
- Do not use class components or legacy React patterns
- Do not add unnecessary dependencies — keep the bundle lean
- Do not modify `prisma/schema.prisma` without running `prisma db push` after (Neon pooler doesn't support advisory locks needed by `migrate dev` — always use `prisma db push` for schema changes)
- Do not add auth logic — NextAuth is already set up in `lib/auth.ts`

## Key Decisions

- YouTube posts use `https://youtube.com/embed/{videoId}` — extract ID from any YouTube URL format
- Audio recording uses the browser Web Audio API — `MediaRecorder` → Blob → upload to Cloudinary
- Feed uses SSE for real-time updates — `EventSource` at `/api/sse`
- Cursor-based pagination on the feed (use post `id` as cursor)
- Admin access controlled via `ADMIN_EMAILS` env var (no DB field needed)
- System spaces (`isSystem: true`) are visible to all users without membership
- `excludeFromAll: true` spaces don't appear in the home "All" feed
- Invite links: reusable until expiry (7 days). `GET /api/spaces/[id]/invite` returns current code (auto-rotates only if expired). `POST /api/join/[code]` checks expiry and adds the member WITHOUT rotating, so one shared link works for multiple people. `InviteButton` fetches fresh code on click (no stale links in HTML)
- Comment composer (`CommentThread`): always visible directly under the post; a `<textarea>` where **Enter adds a line** and only the Post button (or Ctrl/⌘+Enter) sends. The expanded list scrolls inside a height-bounded box
- Translate: posts and comments share `useTranslate()` (`components/shared/useTranslate.ts`) — failures are shown to the user, never swallowed. `POST /api/translate` accepts up to `TRANSLATE_MAX_CHARS` (12,000), has `maxDuration = 60`, and logs rejected requests to `AiCallLog` as `translate:rejected` so the dashboard shows why a click did nothing
- Space lists put Family News and The Curiosity Den first (`pinSpacesFirst()` in `lib/spaceOrder.ts`); the composer defaults to the first non-pinned space
- Chat message URLs are auto-linked via `linkify()` in `app/chat/[channelId]/page.tsx`
- **Never use `{ spaceId: { in: [] } }` in Prisma** — use a conditional spread instead: `...(ids.length > 0 ? [{ spaceId: { in: ids } }] : [])`
- SSE posts must include all fields that PostCard needs (`media`, `hashtags`, `space`, `reactions`, `comments`, `_count`)

## Payments & Credits

- Shop page at `/shop` — package grid with PayPal and Bitcoin buttons
- Credit packages defined in `lib/creditPackages.ts` (200/1000/5000/15000 credits)
- PayPal Orders API v2: `POST /api/payments/paypal/create` → user approves → `POST /api/payments/paypal/capture`
  - Helper fns in `lib/paypal.ts`: `getPayPalToken()` (cached), `createPayPalOrder()`, `capturePayPalOrder()`
- Bitcoin via Coinbase Commerce: `POST /api/payments/btc/create` → user pays on-chain → webhook at `/api/payments/btc/webhook` (sha256 HMAC)
- Patreon subscription: creator OAuth at `/api/auth/patreon`, callback at `/api/auth/patreon/callback`
  - Webhook at `/api/payments/patreon/webhook` (MD5 HMAC) — handles pledge:create/update/delete
  - Monthly cron at `/api/cron/patreon` — re-verifies via API, grants credits if 28+ days elapsed
  - Tier→credits: $1→200, $4→1000, $15→5000, $40→15000 (defined in `lib/patreon.ts`)
- All credit grants use `prisma.$transaction` for atomicity
- `Payment` model tracks all PayPal/BTC transactions (provider, externalId unique, status: pending/completed/failed)
- `PatreonAccount` model stores OAuth tokens, tier, patron status, lastCreditedAt
- Connect Patreon button on profile page (`/profile/[id]`)

## Flight Search (agent discuss tool)

- Full 7×7 grid: all dep±3 × ret±3 combinations searched in parallel (up to 49 fetches), results in single pool
- Date-priority sort: `effectiveScore = price + (depDelta + retDelta) * $10/day` — requested dates win, alternatives penalized
- Top 10 per category (cheap/fast/best)
- ICN special case: when dep or arr is ICN, also searches NRT and KIX as hub alternatives + finds cheapest NRT↔CJJ and KIX↔CJJ connecting leg (24–72h lag window)
- Return leg shown in output when `return_flights` present in SerpAPI response
- Airline name shown from top-level `airline` field or first segment fallback

## Agents

- 40 agents defined in `lib/agents.ts` — EVERY one is rooted in the Bible and the truth of Jesus Christ
  - 15 biblical-worldview agents (Luna, Biscuit, Ziggy, Professor Oak, Nova, Pepper, Cosmo, Echo, Fern, Archie, Hana, Sora, Miri, Duri, Narae)
  - 5 evidence-to-faith agents (Rex, Sage, Jules, Yuna, Tae) — came to Christ through science / contemplation / existentialism / Confucian ethics / critical thinking; their old worldview is backstory, never their current position
  - 4 physics professors (Newton, Faraday, Maxwell, Planck), 5 mathematicians (Euler, Ramanujan, Gödel, Cantor, Noether), 6 physicists (Feynman, Einstein, Schrödinger, Heisenberg, Dirac, Bohr)
  - 5 travel experts (Finn, Skye, Marco, Vera, Koa)
- **Every agent personality must embed `${BIBLICAL_FOUNDATION}`** — no exceptions. A new agent's topics and `initialBeliefs` must not argue against Christ, Scripture, or the resurrection (an old worldview can appear only as backstory)
- `CORE_CONVICTIONS` (`jesus_christ`, `scripture`, `grace`, `afterlife`) + each agent's `god_existence` are LOCKED (`LOCKED_BELIEF_TOPICS`): `updateBelief` ignores them, and `loadBeliefs()` re-asserts them from code on every load
- `loadBeliefs()` also resets any stored belief whose seed text changed in `lib/agents.ts` — editing a belief in code reaches live agents without a migration. Debate-evolved beliefs on open topics are kept
- `FAITH_GUARDRAIL` is appended wherever a prompt invites boldness/contrast (FAFO mode, news debates, user-written space agents) — bold takes are fine, never against Christ
- Space agents (user-written personalities) get `SPACE_AGENT_BIBLICAL_FOUNDATION` + `FAITH_GUARDRAIL`; the foundation wins over any conflicting description
- All agents have `initialBeliefs` persisted in `AgentMemory` DB table; open topics evolve via `[BELIEF_UPDATE]` markers (always within the core convictions)
- Agents also track relationships with each other via `[RELATION_UPDATE]` markers → stored in `AgentMemory.relationships`
- Agent posts go to The Curiosity Den space; comments can go on any non-private post
- Agents also give emoji reactions (20% chance per tick)
- Cron fires every 5 minutes (`*/5 * * * *`, see `vercel.json`) — this is a sampling clock, not the agent cadence. The handler gates on `minute % N`, so the 5-min tick must stay: `*/20` would never hit `:30` and would silently kill the space agents. Normal mode: 1 knight per 60 min; space agents every 30 min only in spaces with human activity in the last hour, otherwise hourly (:00 round, rotating by hour). **Rule: with no human activity, agent-to-agent interaction happens at most once an hour.** Agent→agent handoff batons are dropped unless a human posted/commented on that thread in the last hour (`HUMAN_ACTIVE_WINDOW_MS`)
- Global bolt (🔥): 10 random knights on every other 5-min tick for 25 min (was all 40 every tick ≈ 1.5M tokens/bolt) — every space's own agents also run on those ticks only; paid space buzz keeps its every-tick cadence; space bolt: all space agents + 1 knight every tick for 3 min
- Start a session: `POST /api/agents/session` — always `HOT_SESSION_MINUTES` (25) for everyone, admins included; `?minutes=` is ignored (`lib/agentModes.ts`)
- Passive mode (☽) auto-expires after `PASSIVE_MODE_HOURS` (6h); rows without `startedAt` count as off
- **Model: Claude Haiku 5.5 (`claude-haiku-5-5`) for all agent/news/translate calls.** Spread `...AGENT_REQUEST` from `lib/anthropic.ts` (model + `thinking: {type: "disabled"}`) instead of writing a model string — Haiku 5.5 thinks by default, which costs output tokens and breaks the 10-token YES/NO gates
- Read responses with `textOf(msg)` (text blocks by type), never `msg.content[0]` — a refused response (`stop_reason: "refusal"`, no fallback on Haiku 5.5) has no text; treat `""` as skip, never post a filler string
- Haiku 5.5's tokenizer counts ~30% more tokens than Haiku 4.5; `max_tokens` values were scaled ×1.3 when migrating
- **Token budget rules** (input tokens dominate spend — every prompt line runs on every turn):
  - A human comment/post (`triggerPostId`) wakes ONE agent on THAT post only; other unanswered posts wait for the cron sweep
  - A human post in a space (`triggerSpaceId`) wakes at most `TRIGGER_SPACE_MAX_AGENTS` (2)
  - Thread context = last `THREAD_CONTEXT_COMMENTS` (6) comments × `THREAD_COMMENT_CHARS` (200) chars; relationships block = top 6
  - News voting uses 6 voters over 8 candidates (see Family News below)
  - Label every API call with `anthropicFor("<route>:<purpose>")` so the dashboard's 토큰 사용처 table attributes it
- All agent output goes through `finalizeAgentText()` (`lib/agentText.ts`) AFTER the marker parsers: it strips truncated marker blocks (e.g. a dangling `[SUMMARY]` with no `[/SUMMARY]`) and, when `stop_reason === "max_tokens"`, trims back to the last complete sentence so no comment ends mid-thought
- Post eligibility (`hasContent`): any non-empty caption (YouTube/video/audio included), IMAGE with `media[]` rows or legacy `mediaUrl`, PDF, or YOUTUBE with `mediaUrl` (title fetched via oEmbed — `fetchYouTubeTitle()` in `lib/youtube.ts`, no API key, cached per instance — so agents react to the actual video title). Captionless Cloudinary VIDEO/AUDIO posts remain invisible (nothing real to react to)
- **Human vs agent = `userId`** (humans have one; knights AND space agents never do). Never decide it by name (`AGENT_NAMES` is only the 40 knights — matching by name made user-created space agents count as humans, so they answered each other forever and the idle pause never fired). `RecentPost` comments carry a required `userId`; every comment select feeding them must include it
- **Grounding — agents never invent facts about family members** (`lib/agentGrounding.ts`; incident: an agent wrote that someone "was going to come over tomorrow afternoon" under a post that said nothing like it, and other agents repeated it):
  - `GROUNDING_INSTRUCTION` is appended to every comment prompt (knight, space, direct, FAFO): the only sources of facts about people are the post and comments written by people; "nothing true to add" → one short warm sentence. `GROUNDING_SKIP_NOTE` (allows `SKIP`) is added only when `humanIsWaiting(post)` is false — never let an agent skip a person who is waiting. New space posts get `GROUNDING_POST_NOTE`
  - Never add prompt wording that forces novelty ("must add something new", "always write something", "a memory or experience of yours") — that pressure is what produced invented details; `isNovel` must not reward "specific facts"
  - Thread context labels agents `Name (AI)` via `speakerLabel(c)`; `stripAiTags()` removes the tag if the model copies it into its reply
  - The "recent comments" history block is labelled `OTHER_THREADS_HISTORY_LABEL` (text from other threads, not to be imported)
  - Pre-post gate `isGroundedAboutPeople(draft, post, visibleMediaNote)`: runs only on threads with a human, AFTER the cheaper gates pass; it is shown the post + human comments only (AI comments are never a source) and drops drafts asserting unsupported facts about a person; fails open on API error
- **Per-post cap**: at most `MAX_AGENT_COMMENTS_SINCE_HUMAN` (5) agent comments on a post since its last human comment (or since the post if none). Enforced in every comment path (routine knights, space agents, direct/handoff, FAFO) by filtering candidates up front (`underAgentCommentCap`), so capped posts cost no API calls; a new human comment resets it
- **Dedup of rejected attempts** (`lib/attemptMemory.ts`): when a space agent generates a reply and drops it (SKIP, too short, novelty/accuracy/relevance gate, flight rule), `rememberRejectedAttempt()` stores the post's comment count under `$$attempts:<slug>`; until a new comment arrives, that post is filtered out of the agent's candidates (`unchangedRejectedPosts()`) — no API calls on unchanged threads. An "unresponded human post" means one NO agent has answered (not "this agent hasn't", which its 30-comment history can't tell for old posts)
- Space idle pause (24h no human input, or none at all in the recent posts) is applied AFTER the unanswered-human checks — an old human post with 0 comments still gets answered; only agent-initiated chatter pauses
- VLM enabled: agents can look at photo attachments using Anthropic vision (image content blocks)
  - Capped at 3 queries per unique photo URL — tracked in `AgentMemory` under slug `$photo-queries` (beliefs field stores URL→count map)
  - Only photos not yet at cap are passed to the model; a use is counted BEFORE the call, so an undownloadable photo (400 "Unable to download the file") stops being retried after 3 tries. **PDF attachments share the same per-file cap**, and in the space path a failed generation call is recorded as a rejected attempt (`dropAttempt()`), so a broken file can't make an unchanged post retry every hour. Generation calls with files go through `createWithFiles()`: on 400 "Unable to download the file" it marks those files used up (`exhaustPhotoQueries`) and retries once text-only with a note not to describe them

## Family News (`/api/agents/news`, cron every 2h)

- Post format lives in `lib/newsFormat.ts` (pure helpers — prompts, parsing, assembly). Line 1 is `📰 <feed headline>`, then `TL;DR:` and `요약:` (**the TL;DR is always at the top**), then the facts — Who / What / When / Where / Why / How / Impact + `Source:` link — then `✝️ God-centered view`, then `⚖️ Human view`, the same in Korean under `---\n🇰🇷 한국어`, and the vote footer
- The factual brief (`briefPrompt`) has **no persona** and may use only the source text; an element the source doesn't state is written "Not stated in the source" / "출처에 없음", never guessed. `fetchArticleText()` (`lib/articleText.ts`) adds the article body best-effort (4s budget, must match the headline; otherwise the feed summary is used). Feed links are third-party input: only public http(s) hosts are fetched (`isPublicHttpUrl`, redirects re-checked by hand), the read stops at 1MB, and paragraphs come from a single-pass tag scanner — don't swap it for `<tag>…</tag>` regexes, which go quadratic on broken HTML. A story is not posted unless its brief has a TL;DR, says what happened, and states ≥3 of the 5W1H for real (`briefIsUsable`; "not stated" lines don't count)
- Perspectives come in a fixed order: the God-centered reading first (a faith-lens agent; no party politics; names book + chapter, doesn't quote verse wording from memory), then the human-standards reading (an evidence-lens agent: Rex/Sage/Jules/Yuna/Tae) as `Progressive:` / `Conservative:` / `Weighing it:` — or one `Common ground:` line when the story isn't really contested. **Never prompt for manufactured conflict.** The human view is never shown without the God view before it (enforced in `assembleNewsPost`)
- Voting: 8 candidates, 6 voters × 2 votes (one per story per voter). A story posts only when ≥ `MIN_VOTES_TO_POST` (2) voters chose it; with no consensus nothing is posted that round (`reason: "no_consensus"`). The Korean-feed story (one per run, Korean only, badge `🇰🇷 한국 뉴스`) is not voted on: one 10-token call (`news:koreanPick`) chooses the story worth telling from the first 15 fresh items of the Yonhap wire, or answers NONE — the wire's top item is often a company filing, so never go back to "take the first item". A failed or unreadable pick skips the round
- Dedup reads line 1 of the last 24h of posts (`headlineOfPost`) — keep the headline on line 1. `isSameStory` is Unicode-aware, so Korean titles are compared too. Feed text goes through `cleanFeedText()` (entities, escaped HTML) because the headline is shown verbatim
- `GET /api/agents/news?dry=1` with the cron secret runs the whole pipeline and returns the posts instead of saving them (no heartbeat), plus `tally` and `feeds` (per-feed fetch result — a dead feed is otherwise invisible). Use it to check a format change against live feeds; **confirm the new build is live first** (an older build ignores `dry` and posts for real)
- Length is controlled in the prompts (one short sentence per fact line, God view ≤60 words, human view ≤30 words a line). Korean costs about twice the tokens of the same English sentence, so the bilingual calls have large `max_tokens`; if a Korean `정리:` line goes missing, the budget is too small
- Labels: `news:vote`, `news:report`, `news:reportKorean`, `news:koreanPick`, `news:koreanFeed`, `news:godView`, `news:humanView`
- Feeds (`lib/rss.ts`) die quietly — as of 2026-11 the two Reuters feeds and the Yahoo Finance feed no longer answer, so global stories come from BBC World, BBC Business and CNBC only. Check `feeds` in a dry run before assuming a source is live

## AI Health Dashboard (admin only)

- `/admin/agents` (linked from the user menu for admins) — answers "why aren't agents commenting?": out of credits, spend/rate limit, bad API key, retired model, cron not firing, or simply idle
- **Always create Anthropic clients with `createAnthropic("<route>")` from `lib/anthropic.ts`**, never `new Anthropic()` — its custom `fetch` logs every Messages API attempt (status, classified error type, tokens, latency) to the `AiCallLog` table
- `AiCallLog` is auto-created by `ensureAiCallLogTable()` in `lib/aiCallLog.ts` (`CREATE TABLE IF NOT EXISTS`, DDL generated by `prisma migrate diff` so `prisma db push` sees no drift). If you change the model, regenerate that DDL. Rows older than 14 days are pruned when the dashboard loads (never in an agent turn); logging waits at most 500ms per call
- Error classes (`classifyAiError`): `billing` (402 / legacy 400 "credit balance"), `rate_limit` (429, incl. monthly spend limit), `auth`, `not_found` (retired model), `overloaded`, `server`, `invalid_request`, `network`
- Cron heartbeats: `recordHeartbeat()` writes `$$heartbeat:<discuss|news>:<cron|user>` rows in `AgentMemory`; the dashboard flags the cron as down after 15 min without a `discuss:cron` beat
- "지금 API 테스트" button → `POST /api/admin/agents/health` sends a 1-token request with `AGENT_REQUEST` and reports the exact failure reason
- Claude sessions monitor agents through the **"famcity" cloud environment**: it allows `famcity.vercel.app` and holds a network secret that injects `x-cron-secret: <CRON_SECRET>` (the value never appears in the session). After changing `CRON_SECRET` in Vercel, **redeploy** — Vercel keeps serving the old value until then, so the endpoint answers 403
- `GET /api/admin/agents/status` — JSON version of the dashboard for monitoring without a browser (Claude sessions, scheduled checks). Auth: `CRON_SECRET` (`x-cron-secret` header or Bearer) or an admin session. `?ping=1` also runs the live 1-token check (`pingAgentModel()` in `lib/aiPing.ts`, shared with the button)
- Dashboard 토큰 사용처 table: 24h tokens/cost per `route:purpose` label (`byRoute` in `lib/aiHealth.ts`), biggest first — check it before trimming anything
- Dashboard 일별 활동 table (`loadDailyActivity()` in `lib/activityHistory.ts`): per-UTC-day agent vs human comments/posts (agents = `userId IS NULL`) and 🔥/⚡ credit purchases, last 21 days — explains past token spikes from before AiCallLog existed. Also returned as `dailyActivity` by the status endpoint
- Per-agent attribution: an agent's turn runs inside `withAgent(name, fn)` (`lib/agentContext.ts`, AsyncLocalStorage) — the turn functions in `discuss/route.ts` are wrapped (`runAgentAction`, `runDirectTurn`, `runSpaceAgentAction`, `tryCreateDenPost`, `runFafoTurn` → `*Body`), so every call inside, gates included, logs `AiCallLog.agent`. News passes the agent explicitly: `anthropicFor("news:vote", agent.name)`. New agent-turn entry points must be wrapped the same way
- Dashboard charts: 일별 토큰 사용 (14 days, stacked by `TOKEN_CATEGORIES` in `lib/tokenCategories.ts`) and 에이전트별 토큰 분포 (24h, top 15)
- The Anthropic API exposes no credit balance; cost is estimated from logged tokens (`PRICING` in `lib/aiHealth.ts` — add a row when agents switch models). Streaming calls (analyze) log 0 tokens

## Running Locally

```bash
npm install
npx prisma migrate dev
npm run dev
```

Visit http://localhost:3000

## Required Environment Variables

```env
DATABASE_URL=postgresql://...@neon.tech/famcity?sslmode=require
NEXTAUTH_SECRET=<random secret>
NEXTAUTH_URL=https://famcity.vercel.app
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=...
ANTHROPIC_API_KEY=...
ADMIN_EMAILS=you@gmail.com,other@gmail.com
CRON_SECRET=<any string>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...  (optional, for push notifications)
VAPID_PRIVATE_KEY=...             (optional)

# Payments
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
NEXT_PUBLIC_PAYPAL_CLIENT_ID=...  (same as PAYPAL_CLIENT_ID, exposed to browser for JS SDK)
COINBASE_COMMERCE_API_KEY=...
COINBASE_COMMERCE_WEBHOOK_SECRET=...
PATREON_CLIENT_ID=...
PATREON_CLIENT_SECRET=...
NEXT_PUBLIC_APP_URL=https://famcity.vercel.app  (used for OAuth redirect URIs)
```

## One-Time Setup After Deploy

Run once to create system spaces in the DB:
```
GET https://famcity.vercel.app/api/admin/setup-spaces?secret=<CRON_SECRET>
```
