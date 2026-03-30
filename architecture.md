# FamCity — Architecture

## Overview

FamCity is a private family social feed web app. Members can post text, YouTube embeds, images, and audio recordings. The system is designed for a small, trusted group (no public access), with auth deferred to a later phase.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Next.js Frontend (React)               │   │
│   │                                                     │   │
│   │  Feed Page  │  Compose  │  Profile  │  Media View   │   │
│   └─────────────────────────┬───────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────┘
                              │ HTTP / REST
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js API Routes (Node.js runtime)           │
│                                                             │
│   /api/posts    /api/media/upload    /api/reactions         │
│   /api/comments /api/users (phase 2) /api/auth (phase 2)   │
└──────────┬──────────────────┬────────────────────────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌───────────────────────────────────────┐
│   PostgreSQL DB  │  │        File Storage (Cloudinary)      │
│                  │  │                                       │
│  posts           │  │  /images/*                            │
│  users (ph2)     │  │  /audio/*                             │
│  reactions       │  │                                       │
│  comments        │  └───────────────────────────────────────┘
└──────────────────┘
```

---

## Tech Stack

| Layer        | Choice              | Reason                                              |
|--------------|---------------------|-----------------------------------------------------|
| Framework    | Next.js 14 (App Router) | SSR + API routes in one repo, great DX          |
| UI           | React + Tailwind CSS | Fast styling, responsive by default               |
| Database     | PostgreSQL (via Prisma ORM) | Relational, great for structured feed data  |
| File Storage | Cloudinary          | Free tier generous; handles image + audio upload   |
| Audio        | Web Audio API (browser) | Native recording, no extra lib needed          |
| YouTube      | YouTube oEmbed API  | No API key required to embed by URL               |
| Auth (later) | NextAuth.js         | Plug-and-play with Next.js, many providers         |
| Deployment   | Vercel + Neon DB    | Free tier, zero-config Next.js deploy             |

---

## Data Model

### Post
```
Post {
  id          String    @id @default(cuid())
  authorId    String?   // nullable until auth added
  authorName  String    // display name (free text in phase 1)
  content     String?   // optional text body
  type        PostType  // TEXT | IMAGE | YOUTUBE | AUDIO
  mediaUrl    String?   // Cloudinary URL (image/audio) or YouTube URL
  thumbnailUrl String?  // auto-generated thumbnail
  createdAt   DateTime  @default(now())
  reactions   Reaction[]
  comments    Comment[]
}

enum PostType { TEXT IMAGE YOUTUBE AUDIO }
```

### Reaction
```
Reaction {
  id        String   @id @default(cuid())
  postId    String
  emoji     String   // e.g. "❤️" "😂" "🎉"
  name      String   // reactor display name
  createdAt DateTime @default(now())
}
```

### Comment
```
Comment {
  id        String   @id @default(cuid())
  postId    String
  authorName String
  body      String
  createdAt DateTime @default(now())
}
```

---

## Key Frontend Components

```
app/
├── page.tsx                  # Feed (infinite scroll, all posts)
├── compose/page.tsx          # New post — pick type, fill form, submit
├── posts/[id]/page.tsx       # Single post expanded view
└── layout.tsx                # Nav, global styles

components/
├── Feed/
│   ├── PostCard.tsx          # Renders any post type
│   ├── YoutubeEmbed.tsx      # Embed iframe from URL
│   ├── ImagePost.tsx         # Lightbox image
│   └── AudioPlayer.tsx       # Custom audio player UI
├── Compose/
│   ├── ComposeBar.tsx        # Top-level type selector
│   ├── AudioRecorder.tsx     # Browser mic → Blob → upload
│   ├── ImageUploader.tsx     # Drag-drop / file pick
│   └── YouTubeInput.tsx      # URL input + preview
└── shared/
    ├── ReactionBar.tsx
    ├── CommentThread.tsx
    └── NamePicker.tsx        # Phase 1 "who are you?" selector
```

---

## API Routes

| Method | Path                    | Description                        |
|--------|-------------------------|------------------------------------|
| GET    | /api/posts              | Paginated feed (cursor-based)      |
| POST   | /api/posts              | Create a post                      |
| GET    | /api/posts/[id]         | Single post + comments + reactions |
| DELETE | /api/posts/[id]         | Delete own post                    |
| POST   | /api/media/upload       | Upload image or audio to Cloudinary|
| POST   | /api/posts/[id]/react   | Add/toggle reaction                |
| POST   | /api/posts/[id]/comments| Add comment                        |

---

## Phase 2: Authentication

When auth is added (NextAuth.js):
- Replace `authorName` free text with a real `User` record
- Add Google / Apple / Email magic link login
- Lock delete/post to authenticated user
- Add family invite link flow

---

## Security Considerations (Phase 1)

- No sensitive data stored — only names, text, media URLs
- Cloudinary upload preset set to "authenticated" to block public direct uploads
- Rate limiting on POST /api/posts (upstash/ratelimit or simple IP check)
- No PII collected without auth

---

## Deployment

```
Vercel (frontend + API routes)
  └── Environment vars:
        DATABASE_URL          → Neon PostgreSQL connection string
        CLOUDINARY_URL        → Cloudinary API credentials
        NEXTAUTH_SECRET       → (phase 2)
        NEXTAUTH_URL          → (phase 2)

Neon DB (PostgreSQL, serverless)
Cloudinary (media CDN)
```
