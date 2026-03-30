# FamCity — Implementation Plan

## Goal

Build a private family social feed web app where family members can post YouTube videos, images, recorded audio, and text. Login is deferred to Phase 2. Ship a working MVP first.

---

## Phases

### Phase 1 — MVP (No Auth)

#### Milestone 1: Project Scaffolding
- [ ] `npx create-next-app@latest famcity --typescript --tailwind --app`
- [ ] Install dependencies: `prisma`, `@prisma/client`, `cloudinary`, `next-cloudinary`, `zod`, `date-fns`
- [ ] Set up Prisma schema (Post, Reaction, Comment models)
- [ ] Connect to Neon PostgreSQL via `DATABASE_URL`
- [ ] Run `prisma migrate dev --name init`
- [ ] Create `.env.local` with all required vars
- [ ] Set up Cloudinary account + unsigned upload preset for images and audio

#### Milestone 2: Feed
- [ ] GET `/api/posts` — paginated, newest first, include reaction counts + comment counts
- [ ] `PostCard` component — renders correct sub-component based on `type`
- [ ] `Feed` page — shows all posts, pull-to-refresh or auto-poll every 30s
- [ ] Empty state (first post CTA)

#### Milestone 3: Compose — Text + YouTube
- [ ] Floating compose button → modal or dedicated `/compose` page
- [ ] `NamePicker` — dropdown of family member names (hardcoded list in phase 1)
- [ ] Text post: textarea + submit
- [ ] YouTube post: URL input → parse video ID → show embed preview → submit
- [ ] Validate with Zod before POST

#### Milestone 4: Compose — Image Upload
- [ ] `ImageUploader` component: drag-and-drop or file picker
- [ ] Client-side preview before upload
- [ ] Upload to Cloudinary via `/api/media/upload` (server-side signed upload)
- [ ] Store returned `secure_url` in post record
- [ ] Show image in feed with lightbox on click

#### Milestone 5: Compose — Audio Recording
- [ ] `AudioRecorder` component using `navigator.mediaDevices.getUserMedia`
- [ ] Record → playback → re-record flow
- [ ] Convert Blob → upload to Cloudinary as audio file
- [ ] `AudioPlayer` component in feed (custom play/pause/seek bar)

#### Milestone 6: Reactions + Comments
- [ ] `ReactionBar` — emoji picker (❤️ 😂 🎉 😢 🙌), toggle on/off per name
- [ ] POST `/api/posts/[id]/react` — upsert reaction
- [ ] `CommentThread` — inline below post, expand/collapse
- [ ] POST `/api/posts/[id]/comments`
- [ ] Show commenter name + timestamp

#### Milestone 7: Polish + Deploy
- [ ] Mobile-responsive layout (Tailwind breakpoints)
- [ ] Loading skeletons for feed
- [ ] Error boundaries and toast notifications
- [ ] Delete own post (by name match in phase 1)
- [ ] Deploy to Vercel, connect Neon DB + Cloudinary env vars
- [ ] Share URL with family

---

### Phase 2 — Auth + Accounts

- [ ] Install NextAuth.js
- [ ] Add `User` model to Prisma schema
- [ ] Google OAuth login (or magic link email)
- [ ] Link existing posts to user accounts
- [ ] Family invite link — generate token, validate on first login
- [ ] Role: admin (can delete any post) vs. member
- [ ] Profile page: name, avatar, post history
- [ ] Push notifications (optional): new post → family members notified

---

### Phase 3 — Nice-to-Haves

- [ ] Real-time feed updates (WebSockets or Vercel Edge streaming)
- [ ] Video upload (direct, not just YouTube links)
- [ ] Stories / ephemeral posts (expire after 24h)
- [ ] Birthday reminders and calendar integration
- [ ] Native mobile app (React Native or PWA)
- [ ] Private DMs between family members

---

## File Structure (Phase 1 target)

```
famcity/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # Feed
│   ├── compose/
│   │   └── page.tsx
│   ├── posts/
│   │   └── [id]/
│   │       └── page.tsx
│   └── api/
│       ├── posts/
│       │   ├── route.ts            # GET list, POST create
│       │   └── [id]/
│       │       ├── route.ts        # GET single, DELETE
│       │       ├── react/route.ts
│       │       └── comments/route.ts
│       └── media/
│           └── upload/route.ts
├── components/
│   ├── Feed/
│   ├── Compose/
│   └── shared/
├── lib/
│   ├── prisma.ts                   # PrismaClient singleton
│   ├── cloudinary.ts               # Cloudinary config
│   └── validators.ts               # Zod schemas
├── prisma/
│   └── schema.prisma
├── public/
├── .env.local
└── package.json
```

---

## Dependencies

```json
{
  "dependencies": {
    "next": "14.x",
    "react": "18.x",
    "react-dom": "18.x",
    "@prisma/client": "latest",
    "cloudinary": "latest",
    "next-cloudinary": "latest",
    "zod": "latest",
    "date-fns": "latest",
    "clsx": "latest"
  },
  "devDependencies": {
    "prisma": "latest",
    "typescript": "5.x",
    "tailwindcss": "3.x",
    "@types/node": "latest",
    "@types/react": "latest"
  }
}
```

---

## Environment Variables

```
# .env.local
DATABASE_URL=postgresql://...@neon.tech/famcity?sslmode=require
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name
```

---

## Risks & Mitigations

| Risk                              | Mitigation                                          |
|-----------------------------------|-----------------------------------------------------|
| Audio recording not supported     | Graceful fallback message; file upload alternative  |
| Cloudinary free tier limits       | ~25GB bandwidth/month — fine for family use         |
| No auth = anyone can post         | URL is private (share only with family)             |
| Neon DB cold starts               | Use connection pooling URL from Neon dashboard      |
