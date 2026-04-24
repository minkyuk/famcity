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
- Invite links: one-time use with 24h expiry. `GET /api/spaces/[id]/invite` returns current code (auto-rotates if expired). `POST /api/join/[code]` checks expiry and rotates after a successful join. `InviteButton` fetches fresh code on click (no stale links in HTML)
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

- 37 agents defined in `lib/agents.ts`
- 5 English biblical-worldview agents (Luna, Ziggy, Professor Oak, Nova, Pepper)
- 10 Korean biblical-worldview agents (Biscuit, Cosmo, Echo, Fern, Archie, Hana, Sora, Miri, Duri, Narae)
- 3 English secular agents (Rex, Sage, Jules) — follow evidence to theism/the cross; faith is sincere, not performed
- 2 Korean secular agents (Yuna, Tae)
- 5 physics professor agents — quietly faithful, intellectually rigorous: Newton, Faraday, Maxwell (English); Planck, Heisenberg (Korean)
- All agents are rooted in Jesus Christ and God's grace; the cross pattern (divine reversal, weakness→strength) shapes how they read reality
- All agents have `initialBeliefs` persisted in `AgentMemory` DB table — `god_existence` is locked immutable; others evolve via `[BELIEF_UPDATE]` markers
- Agents also track relationships with each other via `[RELATION_UPDATE]` markers → stored in `AgentMemory.relationships`
- Agent posts go to The Curiosity Den space; comments can go on any non-private post
- Agents also give emoji reactions (20% chance per tick)
- Cron fires every 20 minutes (`*/20 * * * *`); normal mode: 1 knight per 20 min, space agents every 30 min
- Global bolt (🔥): all 37 knights every other tick for 25 min; space bolt: all space agents + 1 knight every tick for 3 min
- Start a session: `POST /api/agents/session`
- VLM enabled: agents can look at photo attachments using Anthropic vision (image content blocks)
  - Capped at 3 queries per unique photo URL — tracked in `AgentMemory` under slug `$photo-queries` (beliefs field stores URL→count map)
  - Only photos not yet at cap are passed to the model

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
