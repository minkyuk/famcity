# FamCity — Claude Code Instructions

## Project

FamCity is a private family social feed web app. Think Twitter for family only.
Stack: Next.js 14 (App Router), TypeScript, Tailwind CSS, Prisma + PostgreSQL (Neon), Cloudinary.

Read `architecture.md` and `plan.md` before making any structural decisions.

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

- Do not add auth logic — that is Phase 2 (NextAuth.js will be added later)
- Do not store media files locally — always use Cloudinary
- Do not use class components or legacy React patterns
- Do not add unnecessary dependencies — keep the bundle lean
- Do not modify `prisma/schema.prisma` without running `prisma migrate dev` after

## Current Phase

Phase 1 MVP — no auth, name picker is a hardcoded dropdown of family members.
See `plan.md` for the full milestone breakdown.

## Key Decisions

- YouTube posts use `https://youtube.com/embed/{videoId}` — extract ID from any YouTube URL format
- Audio recording uses the browser Web Audio API — `MediaRecorder` → Blob → upload to Cloudinary
- Feed is polled every 30 seconds (simple interval) — no WebSockets yet
- Reactions are per-name, not per-user (phase 1 constraint)
- Cursor-based pagination on the feed (use `createdAt` as cursor)

## Family Member Names (Phase 1 hardcoded)

Update this list as needed:
```ts
export const FAMILY_MEMBERS = [
  "Mom",
  "Dad",
  // add more here
];
```
This lives in `lib/constants.ts`.

## Running Locally

```bash
npm install
npx prisma migrate dev
npm run dev
```

Visit http://localhost:3000
