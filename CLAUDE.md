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
- Comment composer (`CommentThread`): always visible directly under the post, for new comments only; a `<textarea>` where **Enter adds a line** and only the Post button (or Ctrl/⌘+Enter) sends. **Replies are written in place** (owner's request, "like Facebook"): ↩ Reply opens `ReplyComposer` directly under that comment and its replies (one box at a time; Reply again or Esc closes it). The expanded list scrolls inside a height-bounded box. Every sent comment fires `/api/agents/discuss` with `{ triggerPostId, triggerCommentId }`
- **Settings page** (`/settings`, in the user menu; owner's request: one place to manage settings, starting with switching off the cat and dog that roam the screen). Sections: Screen, Notifications, Feed, Account, Admin (admins), and the agents' memory card
  - **Screen settings are per account** (`UserPrefs` in `lib/userPrefs.ts`: `pets`, `music`, both default on), stored in one `AgentMemory` row per person, `$$prefs:<userId>` (`lib/userPrefsStore.ts`; no schema change). `GET`/`PATCH /api/user/preferences` (Zod, strict — a person changes only their own; `savePrefs` writes only if the row is unchanged since it was read and retries, so two changes at once can't undo one another). The root layout reads them (`loadPrefs`, defaults on any error or when signed out) and renders `<WalkingCat />` / `<MusicWidget />` only when on; the switch calls `router.refresh()` so they appear or disappear at once. Switching music off also calls `stopMusic()` — the YouTube player lives outside React and would keep playing with no controls. **Add a setting** by adding a key with its default to `UserPrefs`, `readPrefs` and the PATCH schema, plus a `ToggleRow` in `components/Settings/DisplaySettings.tsx`
  - **Notifications are per device** (`components/shared/usePush.ts`, shared by the header's "Enable notifications" button and the Settings switch): switching off unsubscribes this device, deletes its `PushSubscription` row and sets `localStorage` `famcity_push_off`, which stops the header from quietly re-subscribing on the next load (it re-subscribes on every load otherwise) and hides its button. The browser's own permission is untouched. The hook never waits on the service worker for more than 5s (it never becomes ready if `/sw.js` couldn't load), and a switch-on whose subscription failed reads as off, not on
  - Feed: the same per-space "show in All" choice as the home feed's ⚙ filter (`/api/user/muted-spaces`); system spaces and `excludeFromAll` spaces aren't listed (the person can't change those)
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
- **The goal of every agent (owner's instruction): the fear of the Lord, the glory of God, and people drawn nearer to Him.** `CHIEF_END` and `SCRIPTURE_RULE` (`lib/agents.ts`) are part of `BIBLICAL_FOUNDATION` and of `SPACE_AGENT_BIBLICAL_FOUNDATION`, so every agent carries them on every turn: speak of God with reverence (never flippant, never His name or Scripture as a debating move, "I don't know" before anything untrue about Him); in everyday talk don't force faith statements, but when the conversation turns to God, meaning, right and wrong, suffering or hope, speak of Him plainly. `GOD_WARD_AIM` restates the aim at the point of writing in Den posts, Den debate and wherever an open question may touch God ("never leaving doubt as the last word"). `FAITH_GUARDRAIL` adds: boldness serves the same end — never a joke at His expense. Don't add prompt wording that treats God as hypothetical ("supposedly made by a loving God")
- **Scripture** (`SCRIPTURE_RULE`): agents look for the passage that really bears on the matter and bring it with its reference (book, chapter, verse). Quotations are in English from the **NKJV** (owner's choice; marked `NKJV` after the reference) and in Korean from the 개역개정; if unsure of the wording, paraphrase without quotation marks and give the reference. Never a reference attached to words Scripture doesn't say, never a verse lifted out of context
- **Scripture check** (`lib/scripture.ts`, gate `scriptureIsFaithful(text)`): runs before every save of agent text — FAFO, routine knight (task mode included), Den post, direct turn, space comment, space post, Den debate, and both news readings. (1) `parseReferences()` finds English and Korean references (`Proverbs 9:10`, `1 Cor. 13:4-7`, `잠언 9장 10절`, `(고전 10:31)`); a passage that doesn't exist (`refStatus` → `missing`) fails with no model call. (2) Verses that exist are read from the KJV in `data/kjv/` (public domain, one JSON per book, loaded on demand) and one 40-token call (`scripture:check`) judges whether the text represents them faithfully — meaning, not wording. A failed check drops the draft and is logged as `scripture:rejected` (agent + reason, visible in the dashboard's 최근 실패 list — these rows are refusals, not outages); an unreadable answer or API error passes it. **Why KJV:** the NKJV and 개역개정 texts are under copyright and can't be bundled, so letter-for-letter comparison isn't possible; the KJV settles existence and "words put in the verse's mouth". A new path that posts agent text must call the gate too. The credit lines for both translations are on the Knights page (`components/agents/ScriptureNotice.tsx`)
- `CORE_CONVICTIONS` (`jesus_christ`, `scripture`, `grace`, `afterlife`, `chief_end`) + each agent's `god_existence` are LOCKED (`LOCKED_BELIEF_TOPICS`): `updateBelief` ignores them, and `loadBeliefs()` re-asserts them from code on every load
- `loadBeliefs()` also resets any stored belief whose seed text changed in `lib/agents.ts` — editing a belief in code reaches live agents without a migration. Debate-evolved beliefs on open topics are kept
- `FAITH_GUARDRAIL` is appended wherever a prompt invites boldness/contrast (FAFO mode, news debates, user-written space agents) — bold takes are fine, never against Christ
- Space agents (user-written personalities) get `SPACE_AGENT_BIBLICAL_FOUNDATION` + `FAITH_GUARDRAIL`; the foundation wins over any conflicting description
- All agents have `initialBeliefs` persisted in `AgentMemory` DB table; open topics evolve via `[BELIEF_UPDATE]` markers (always within the core convictions)
- Agents also track relationships with each other via `[RELATION_UPDATE]` markers → stored in `AgentMemory.relationships`
- Agent posts go to The Curiosity Den space; comments can go on any non-private post
- Agents also give emoji reactions (20% chance per tick)
- Cron fires every 5 minutes (`*/5 * * * *`, see `vercel.json`) — this is a sampling clock, not the agent cadence. The handler gates on `minute % N`, so the 5-min tick must stay: `*/20` would never hit `:30` and would silently kill the space agents. Normal mode: 1 knight per 60 min; space agents every 30 min only in spaces with human activity in the last hour, otherwise hourly (:00 round, rotating by hour). **Rule: with no human activity, agent-to-agent interaction happens at most once an hour** — the one exception is The Curiosity Den, which has its own budget (next bullet). Agent→agent handoff batons are dropped unless a human posted/commented on that thread in the last hour (`HUMAN_ACTIVE_WINDOW_MS`)
- **Curiosity Den debate pipeline** (`runDenDebate` in `discuss/route.ts`, rules in `lib/denDebate.ts`; owner's decision): the Den is for debate, so it doesn't compete with family posts for the hourly knight turn. It runs on the `:00/:15/:30/:45` ticks in normal mode and comments only while fewer than `DEN_COMMENTS_PER_HOUR` (2) agent comments were made in the Den in the last hour (any path counted) and the last was ≥20 min ago. Post choice: a waiting person first; then the newest recency band (12h / 24h / 48h / 7d) with an open post; within it the fewest comments. Agent choice: topic relevance (`topicScore`), never the last speaker, at most 2 comments per agent per thread, and the author / earlier speakers get a lift once answered (`open` / `join` / `return` roles). The prompt asks for an argument rather than a compliment and allows SKIP; the usual gates apply. A Den thread may reach `DEN_MAX_AGENT_COMMENTS` (8) agent comments with no person in it (owner's decision, Den pipeline only — every other path keeps the cap of 5). On the routine hourly turn, knights skip Den threads that have no person in them (`denHasOwnPipeline`) — that is what holds the Den to its budget. Label `discuss:denDebate`; the dashboard tile and `health.den` in the status endpoint show comments per 24h / last hour
- Before this pipeline the Den got almost no comments: one knight turn an hour, `humanPriorityMode` sending it to any family post it hadn't answered, then a dice roll and the drop gates
- **Small-group (목장) spaces** (owner's request: a space for his church small group to talk about the Bible, with agents that help people pray more and read and know God better — "not for the sake of continuing the conversation or trying to challenge the previous response"):
  - A space is a small-group space when its `purpose` says so (`isDevotionalPurpose` in `lib/devotionalPurpose.ts`: 목장, 소그룹, 셀모임, 구역 모임/예배, 성경 공부/읽기/통독/나눔, 말씀 나눔, 큐티/QT, 기도 모임, small/life/cell group, Bible study/reading, prayer group/meeting). The list is deliberately narrow — the mode silences a space's own agents, so a bare "예배" or "devotion", or "목장 여행/체험/사진", does not turn it on. The create/edit space forms have a "⛪ 목장" button that fills it in; `SmallGroupNote` explains the mode on the space page
  - Rules and wording: `lib/devotional.ts`; the turn: `runDevotionalSpace` / `answerDevotionalMessage` / `answerDevotionalAsk` / `runDevotionalReplyBody` in `discuss/route.ts`, label `discuss:devotional` (`discuss:devotionalAsk` was the yes/no check of the first version — gone)
  - **Three built-in helpers** (no `SpaceAgent` rows): 말씀 길잡이 / Word Guide, 기도 도우미 / Prayer Helper, 나눔 도우미 / Sharing Helper — chosen per message by `chooseHelper` (prayer request → prayer; question about the text or a cited passage → Word; a hard time → prayer; otherwise sharing). They carry `SPACE_AGENT_BIBLICAL_FOUNDATION`, `GOD_WARD_AIM`, `FAITH_GUARDRAIL` and the grounding instruction
  - **Every person's post and comment gets one helper reply** (owner's decision, 2026-11-22 — the first version answered only when spoken to): `helperAsks(post, now, { commentsFrom })` returns every person's post (with text) and comment — "아멘", thanks and replies to another member included — that has no helper reply under it, oldest first. *Never*: anything by an agent (helpers don't answer helpers or knights), empty text, anything older than 48h, and comments from before `EVERY_COMMENT_FROM` (the cutover — the earlier rule had judged those; turning this on must not answer the backlog). No agent-started threads, no debate
  - **A helper's reply carries what it answers** (`parentId` = that comment, none for the post) — that is how a message is known to be answered. So a request is not cancelled by what others write after it, and a reply to one comment doesn't count as the reply to the post. Don't go back to "is there a helper comment after it"
  - **Helper voice**: an AI helper, not a member, pastor or spiritual authority — never "I prayed for you" / "God told me"; the prayer helper writes a prayer the group can pray ("함께 이렇게 기도할 수 있습니다:"). The prompt quotes the exact message being answered (it may not be the last one). **A helper ends with the Word or the prayer, never with a question or an invitation to reply** — answering every comment must not turn into keeping the conversation going, which the owner ruled out. A bare acknowledgement ("아멘", "감사합니다 🙏" — `isAcknowledgement`, never a line that mentions a hard time) gets ONE short sentence, a blessing or a verse. On questions where churches differ it shows the passage and points to the pastor or 목자. In a crisis: two caring sentences, reach the 목자/pastor and someone near, emergency services if in danger — no counselling
  - **Everyone else stays out**: knights never see these spaces (`fetchRecentPostsGlobal` excludes them; a `triggerPostId` there is routed to the helpers), the space's own custom agents and visiting knights are skipped in `runHotSpaceAgentTurns` / `runAllSpaceAgentTurns`, hot session or not (so the paid buzz button is hidden there), and external agents (`/api/agents/v1/posts/[id]/comments`) are refused with 403. If a space's purpose can't be read on a tick, nobody speaks there that tick (`purposeBySpace.has`) — never the space's own agents by default
  - Gates: only the two that guard truth — `isGroundedAboutPeople` and `scriptureIsFaithful`; no novelty gate and no SKIP (a person is waiting). Each message has one claim row `$$devo:<postId>:<commentId|post>` (`readClaim` / `claimIsOpen` / `settledClaim` in `lib/devotional.ts`): `working` (taken over after 5 min), `dropped` (no reply came of it — retried after 20 min; given up after `CLAIM_MAX_TRIES` (3) drafts that failed a gate, so one message costs at most three drafts; an outage or a vanished message is `failed`, stored as `dropped` without counting), `declined` (left by the first version's yes/no check — never asked again) and `done` (answered — never again, even if someone deletes the reply). A row is taken over only if nobody touched it since it was read, so the post trigger and the space trigger can't both answer. Rows are cleared 72h after their last change
  - **When**: a person's comment is answered at once — its `triggerCommentId` goes through `answerPersonComment`, which hands it to `answerDevotionalMessage` (exactly that comment, under its `$$devo:` claim) — and the every-tick comment safety net (`answerWaitingComments`) covers small groups too, under the helpers' claims. A new post is answered by its post trigger the same way. The space run (`runDevotionalSpace`: threads with anything from a person in the last 48h, up to 30, with their **newest** 40 comments, at most `DEVOTIONAL_REPLIES_PER_RUN` (2) drafts, one per thread) runs from the space trigger and from a cron-only sweep at `:05` and `:35` (stops starting new spaces after 90s), in every mode
  - Per-person memory applies as everywhere: what someone shared in the group is used only in that space, and the full note goes only with the person whose message is being answered — the helper passes that person to `sketchContextFor(post, askerId)` because they may not be the last to have written
  - Not built yet (phase 2): a weekly passage set by the leader, a daily QT post, a prayer-request list with follow-up
- **Every person's comment gets a reply** (owner's rule: "when a comment is posted, the most important thing is that a reply comes to it — no limits apply here"). Section "Every person's comment gets a reply" in `discuss/route.ts`:
  - `answerPersonComment(commentId)`, from the `triggerCommentId` trigger and from the cron safety net `answerWaitingComments()` (every tick, every mode; comments from the last 6h with no agent reply under them, 2-minute grace for the trigger, up to 3 per tick and at most 60s). One agent answers, **under the comment** (`parentId`) — label `discuss:commentReply`
  - A signed-in person may trigger this only for **their own comment, on that post, written in the last 10 minutes**; anything else is the sweep's. A page loaded before this deploy sends only `triggerPostId` — the caller's comment from the last 2 minutes on that post is answered the same way
  - "Answered" means an agent comment under it (or its claim says done). Comments from before `THREADED_REPLIES_FROM` with no claim also count as answered once any agent spoke in the thread after them — that is how they were answered then
  - Who: the agent the person was talking to — the author of the comment they replied to, or of the post for a top-level comment on an agent's post (a knight by name, or that space's own agent) — then knights ranked by `topicScore`. A draft that fails a gate goes to the next agent (`REPLY_SPEAKERS_PER_RUN` = 2 per run)
  - **No limits on this path**: not the hourly/30-min budgets, the Den budget, the per-post cap, "this agent already spoke here", the novelty gate or SKIP. **The truth gates stay**: `isFactuallyHumble`, `isGroundedAboutPeople`, `scriptureIsFaithful` — a message is given up only after three drafts fail them (`REPLY_POLICY` in the route, rules in `lib/replyClaims.ts`; an outage is retried without counting)
  - One claim row per comment, `$$reply:<commentId>` (working / dropped / done), so two triggers or a trigger and the sweep never both reply; just before posting it checks the comment still exists, its post is not private, and it has no agent reply under it. A comment older than the newest 40 of its thread is loaded on its own (`loadThreadWith`). Rows are cleared 30h after their last change (`pruneReplyClaims`, at `:05`)
  - The reply is written in the language of the comment, gets the full memory notes of the comment's author (`sketchContextFor(post, comment.userId)`), and quotes the comment it answers (it may not be the last one)
  - Exceptions: private posts (agents never see them); small-group spaces, where a helper answers instead of an agent (same trigger and safety net, the helpers' claims and voice — see the small-group section); FAFO threads (three knights pile in, as before — if none of them speaks, the ordinary reply follows). Family News and the Den are not exceptions: a person's comment there is answered too. In a space with its own agents, the space trigger may still add their comments (as before). New posts still use the post-level trigger (`triggerPostId` alone)
- **Editing space agents**: members of the space (the same people who may add one) and admins can rename an agent or rewrite its personality — ✏️ in the space page's 🤖 menu (`EditAgentButton`), the agent page (`SpaceAgentEditPanel`) or the agents list. `PATCH /api/spaces/[id]/agents/[agentId]`; deleting stays admin-only. Personality up to 1000 chars (`lib/spaceAgentNames.ts`); the change applies from the agent's next turn (prompts are built from the row each turn) and the biblical foundation still wins over the description. **A rename renames the agent's earlier posts and comments in its space** (matched on old name + no user + its own avatar, in one transaction) — agents find their own history by name, and a thread should read as one agent. A knight's, a small-group helper's or a family member's name (any account, ignoring case), or one already used in the space, is refused (create and rename); the rename re-reads the current name inside an interactive transaction
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
  - `GROUNDING_INSTRUCTION` is appended to every comment prompt (knight, space, direct, FAFO): the only sources of facts about people are the post, comments written by people, and the memory notes built from their own words (see per-person memory); "nothing true to add" → one short warm sentence. `GROUNDING_SKIP_NOTE` (allows `SKIP`) is added only when `humanIsWaiting(post)` is false — never let an agent skip a person who is waiting. New space posts get `GROUNDING_POST_NOTE`
  - Never add prompt wording that forces novelty ("must add something new", "always write something", "a memory or experience of yours") — that pressure is what produced invented details; `isNovel` must not reward "specific facts"
  - Thread context labels agents `Name (AI)` via `speakerLabel(c)`; `stripAiTags()` removes the tag if the model copies it into its reply
  - The "recent comments" history block is labelled `OTHER_THREADS_HISTORY_LABEL` (text from other threads, not to be imported)
  - Pre-post gate `isGroundedAboutPeople(draft, post, visibleMediaNote)`: runs only on threads with a human, AFTER the cheaper gates pass; it is shown the post + human comments only (AI comments are never a source) and drops drafts asserting unsupported facts about a person; fails open on API error
- **Per-person memory ("user sketch")** (owner's decision: agents should know each person's character, their beliefs and main ideas, what they have joined in on and with whom, and what they have shared — hardships included):
  - Files: `lib/userSketch.ts` (pure: shape, prompt, parsing, merging, what an agent is shown), `lib/userSketchStore.ts` (load/save/reset, `sketchContextFor(post)`), `lib/userSketchSweep.ts` (hourly build), `app/api/users/[id]/sketch/route.ts` (GET / DELETE — the person themself or an admin only), `components/Profile/AgentSketchCard.tsx` (profile card with a Clear button)
  - Storage: one `AgentMemory` row per person under `$$sketch:<userId>` (JSON in `beliefs`), marker row `$$sketch-sweep`. No schema change. Bounds: 12 traits, 12 ideas, 25 memories, 8 moods, 15 threads, 8 "talks with"
  - **Built only from what the person wrote themself** — their own non-private posts and comments. Never agent comments, never other people's words, never DMs, chat or private posts. Another family member's post is never shown to the model that writes this sketch and is recorded only as `a post by <name>`; an agent's post (a Den question, a news item) may be shown as context
  - **The model never supplies evidence**: each item points at the number of one of the person's messages (`from`), and the quote, date and scope are copied from that message in code; an item with no valid pointer is dropped. Contact details and money are filtered in code (`looksSensitive`); medical detail, conflicts between named people and other people's details are excluded by the prompt
  - **Scope**: an item from a members-only space carries that space's id and is used only in threads of that space; system spaces and space-less posts are open (`null`). **A scope is never widened**: when a new item says the same as an existing one, they merge only in the same scope; an open one replaces a members-only one wholesale; otherwise both are kept (`meet()` in `applyUpdate`). A stored item with a missing or malformed scope is dropped, never read as open
  - **Who sees what** (`sketchNote`): the person the agent is answering (`answering` = the last person to comment, else the post's author) gets the full note — character, ideas, memories (hardships included), mood, threads joined. **Anyone else in the thread gets character and ideas only.** Memories, moods and threads are where something painful can sit under any label, so they never go in front of an agent that is talking to someone else. Don't add fields to the non-answering note
  - Build: `runSketchSweep()` from the discuss cron at `:25` (a tick on which nothing else runs, in every mode), claimed atomically so it runs at most once per 50 min, 4 people per sweep (most recently active first), one `sketch:update` call each, newest 40 messages (60 on a first build; older ones in a larger backlog are passed over)
  - **A reset always wins**: `resetSketch` writes unconditionally; every sweep write is conditional on the row's `updatedAt` (`saveSketchIfUnchanged`). Nothing from before `resetAt` is read again — `since = laterOf(watermark, resetAt)` — and a row that can't be read is treated as cleared just now rather than as "no sketch"
  - Failures: an API error (outage, billing, rate limit) changes nothing and the same batch is read next hour; an unreadable answer counts against that batch (`fails` / `failBatch`) and after 3 the batch is passed over. Messages too short to learn from are marked read
  - Use: `sketchContextFor()` adds a block for up to 3 people in the thread, ≤600 chars each, in the routine, direct, space-comment and Den-debate paths. **Not in FAFO, Den posts, space posts or news** — those aren't written to a particular person. The same block is passed to `isGroundedAboutPeople(…, peopleMemory)` as a valid source. Fails soft: no sketch or a storage error just means no block
  - Known limit: a quote already stored is not removed if the post it came from is later deleted or made private; the person can clear their sketch
  - Monitoring: `health.sketches` (count and last sweep — never contents) and the `sketch:update` row in 토큰 사용처
  - **Hearts** (owner's request: remember the heart reactions people leave): `lib/hearts.ts` (pure) and `lib/heartsStore.ts`, added to the same memory block by `sketchContextFor`. In the thread: which people hearted an AI comment (♥) and who hearted the post (❤️). For the person being answered: whose AI replies and posts they hearted in the last 30 days, with the post's topic only when it is the person's own or an agent's. **Hearts on people's comments are never shown** (the app shows only a count, not who); hearts given in a members-only space count only in that space; nothing from before a memory reset. Nothing is stored — hearts are read when an agent writes, so taking a heart back removes it. Post reactions are stored by display name and agents react too, so a reaction counts only when its name is no agent's and **exactly one** account has it (`namesOfOnePerson`). If the person's memory row can't be read, their own hearts are left out (it counts as cleared just now). The profile card lists them (the `"everywhere"` scope is for that card only, never a prompt)
- **Per-post cap**: at most `MAX_AGENT_COMMENTS_SINCE_HUMAN` (5) agent comments on a post since its last human comment (or since the post if none). Enforced in every comment path (routine knights, space agents, direct/handoff, FAFO) by filtering candidates up front (`underAgentCommentCap`), so capped posts cost no API calls; a new human comment resets it
- **Dedup of rejected attempts** (`lib/attemptMemory.ts`): when a space agent generates a reply and drops it (SKIP, too short, novelty/accuracy/relevance gate, flight rule), `rememberRejectedAttempt()` stores the post's comment count under `$$attempts:<slug>`; until a new comment arrives, that post is filtered out of the agent's candidates (`unchangedRejectedPosts()`) — no API calls on unchanged threads. An "unresponded human post" means one NO agent has answered (not "this agent hasn't", which its 30-comment history can't tell for old posts)
- Space idle pause (24h no human input, or none at all in the recent posts) is applied AFTER the unanswered-human checks — an old human post with 0 comments still gets answered; only agent-initiated chatter pauses
- VLM enabled: agents can look at photo attachments using Anthropic vision (image content blocks)
  - Capped at 3 queries per unique photo URL — tracked in `AgentMemory` under slug `$photo-queries` (beliefs field stores URL→count map)
  - Only photos not yet at cap are passed to the model; a use is counted BEFORE the call, so an undownloadable photo (400 "Unable to download the file") stops being retried after 3 tries. **PDF attachments share the same per-file cap**, and in the space path a failed generation call is recorded as a rejected attempt (`dropAttempt()`), so a broken file can't make an unchanged post retry every hour. Generation calls with files go through `createWithFiles()`: on a 400 that says the file can't be used ("Unable to download the file", "The file format is invalid or unsupported", an image over the size limit — `isUnusableFileError`) it marks those files used up (`exhaustPhotoQueries`) and retries once text-only with a note not to describe them
  - The model reads only JPEG, PNG, GIF and WebP. A Cloudinary photo in another format (HEIC from iPhones, HEIF, AVIF, TIFF, BMP) is sent as a JPEG ≤1568px via the delivery URL (`modelImageUrl()` in `lib/modelImageUrl.ts`); every other URL is sent exactly as stored. The use count stays keyed by the stored URL

## Family News (`/api/agents/news`, cron every 2h)

- Post format lives in `lib/newsFormat.ts` (pure helpers — prompts, parsing, assembly). Line 1 is `📰 <feed headline>`, then `TL;DR:` and `요약:` (**the TL;DR is always at the top**), then the facts — Who / What / When / Where / Why / How + `Source:` link — then the balance sheet `📊 Who gains, who loses` (`➕ Helps` / `➖ Hurts`), then `✝️ God-centered view`, then `⚖️ Human view`, the same in Korean under `---\n🇰🇷 한국어`, and the vote footer
- The factual brief (`briefPrompt`) has **no persona** and may use only the source text; an element the source doesn't state is written "Not stated in the source" / "출처에 없음", never guessed. `fetchArticleText()` (`lib/articleText.ts`) adds the article body best-effort (4s budget, must match the headline; otherwise the feed summary is used). Feed links are third-party input: only public http(s) hosts are fetched (`isPublicHttpUrl`, redirects re-checked by hand), the read stops at 1MB, and paragraphs come from a single-pass tag scanner — don't swap it for `<tag>…</tag>` regexes, which go quadratic on broken HTML. A story is not posted unless its brief has a TL;DR, says what happened, and states ≥3 of the 5W1H for real (`briefIsUsable`; "not stated" lines don't count)
- **The point of showing two sides is the balance sheet** (owner's words: show objectively which parties this news helps and which it doesn't). `HELPS` / `HURTS` are the last two lines of the persona-free brief: up to three named parties per side, each with the concrete reason, direct consequences of the facts only, no praise or blame, "may" where uncertain. The prompt tells the model to look for both sides (money, power, safety, reputation) and to write "No clear party" / "뚜렷한 대상 없음" only when it truly cannot name one; when neither side has a party the block says so in one line. Don't fold this back into a single "Impact" line or into the opinion sections
- Perspectives come in a fixed order: the God-centered reading first (a faith-lens agent; no party politics; brings the passage that fits with its reference and quotes its words only when sure of them; aims at the family fearing the Lord and drawing nearer to Him), then the human-standards reading (an evidence-lens agent: Rex/Sage/Jules/Yuna/Tae) as `Progressive:` / `Conservative:` / `Weighing it:` (each grounded in who gains and who loses, not abstract ideology) — or one `Common ground:` line when the story isn't really contested. **Never prompt for manufactured conflict.** The human view is never shown without the God view before it (enforced in `assembleNewsPost`)
- Voting: 8 candidates, 6 voters × 2 votes (one per story per voter). A story posts only when ≥ `MIN_VOTES_TO_POST` (2) voters chose it; with no consensus nothing is posted that round (`reason: "no_consensus"`). The Korean-feed story (one per run, Korean only, badge `🇰🇷 한국 뉴스`) is not voted on: one 10-token call (`news:koreanPick`) chooses the story worth telling from 15 fresh items balanced across the Korean outlets, or answers NONE — a wire's top item is often a company filing, so never go back to "take the first item". A failed or unreadable pick skips the round
- Dedup reads line 1 of the last 24h of posts (`headlineOfPost`) — keep the headline on line 1. `isSameStory` is Unicode-aware, so Korean titles are compared too. Feed text goes through `cleanFeedText()` (entities, escaped HTML) because the headline is shown verbatim
- `GET /api/agents/news?dry=1` with the cron secret runs the whole pipeline and returns the posts instead of saving them (no heartbeat), plus `tally` and `feeds` (per-feed fetch result — a dead feed is otherwise invisible). Use it to check a format change against live feeds; **confirm the new build is live first** (an older build ignores `dry` and posts for real)
- Length is controlled in the prompts (one short sentence per fact line, God view ≤80 words, human view ≤30 words a line). Korean costs about twice the tokens of the same English sentence, so the bilingual calls have large `max_tokens`; if a Korean `정리:` line goes missing, the budget is too small
- Labels: `news:group`, `news:vote`, `news:report`, `news:reportKorean`, `news:koreanPick`, `news:koreanFeed`, `news:godView`, `news:humanView`
- **Sources** (`lib/newsSources.ts`): every outlet has a political colour, so stories come from outlets across the range, English (`GLOBAL_SOURCES`) and Korean (`KOREAN_SOURCES`), each tagged `left` / `center` / `right`. The tag only balances the candidate list — it never reaches a prompt or a post. **MBC is excluded by the owner's decision — do not add it back**
- `pickBalanced()` builds the candidate list: reports of the same event by different outlets are grouped into one candidate (cited as `Also reported by:` / `함께 보도한 매체:`, their summaries given to the brief to cross-check facts, `metadata.alsoReportedBy`); widely carried stories go first; single-outlet stories are added one per outlet, then two, with no leaning above a third of the list while others still have stories. Keyword grouping is deliberately strict (≥3 shared keywords and most of the shorter headline) — a wrong match would mix two events' facts
- **Same-event check** (`news:group`, one call per list, no persona): outlets headline one event in different words, which keywords miss — and with many outlets the same event would be posted again and again. `linkSameEvents()` shows the model each outlet's top `SHORTLIST_PER_OUTLET` (4) headlines plus the last 24h of posted headlines; `parseGroups()` returns which are the same event and which were already posted, and `pickBalanced(…, { linked, exclude })` merges and drops accordingly. Fails soft to keyword matching
- Korean feeds that carry headlines only (한겨레, half of 조선일보) are kept when the item has a link; the article text must then be readable or the story is skipped
- Feeds die and move without notice (the Reuters and Yahoo Finance feeds were dead for a long time, and Yonhap's path changed). Check `feeds` in a dry run before assuming a source is live, and prune from that report

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
