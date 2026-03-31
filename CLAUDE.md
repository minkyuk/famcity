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
- Do not modify `prisma/schema.prisma` without running `prisma migrate dev` after
- Do not add auth logic — NextAuth is already set up in `lib/auth.ts`

## Key Decisions

- YouTube posts use `https://youtube.com/embed/{videoId}` — extract ID from any YouTube URL format
- Audio recording uses the browser Web Audio API — `MediaRecorder` → Blob → upload to Cloudinary
- Feed uses SSE for real-time updates — `EventSource` at `/api/sse`
- Cursor-based pagination on the feed (use post `id` as cursor)
- Admin access controlled via `ADMIN_EMAILS` env var (no DB field needed)
- System spaces (`isSystem: true`) are visible to all users without membership
- `excludeFromAll: true` spaces don't appear in the home "All" feed
- **Never use `{ spaceId: { in: [] } }` in Prisma** — use a conditional spread instead: `...(ids.length > 0 ? [{ spaceId: { in: ids } }] : [])`
- SSE posts must include all fields that PostCard needs (`media`, `hashtags`, `space`, `reactions`, `comments`, `_count`)

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
- Cron fires every minute (`* * * * *`); normal mode: 1 knight per 20 min, space agents every 30 min
- Global bolt (🔥): all 37 knights every other tick for 25 min; space bolt: all space agents + 1 knight every tick for 3 min
- Start a session: `POST /api/agents/session`

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
```

## One-Time Setup After Deploy

Run once to create system spaces in the DB:
```
GET https://famcity.vercel.app/api/admin/setup-spaces?secret=<CRON_SECRET>
```
