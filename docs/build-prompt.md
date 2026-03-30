# FamCity — Master Build Prompt

Use this prompt in a fresh Claude Code session (or paste into any AI coding assistant) to build the full FamCity MVP from scratch. It is self-contained and thorough.

---

## Prompt

```
Build a private family social feed web app called "FamCity".

## Stack
- Next.js 14 with App Router and TypeScript
- Tailwind CSS for all styling
- Prisma ORM with PostgreSQL (Neon)
- Cloudinary for image and audio file storage
- No authentication (Phase 1 — name is picked from a dropdown)

## What to build

### 1. Prisma Schema (`prisma/schema.prisma`)

Create three models:

**Post**
- id: cuid
- authorName: String (display name)
- content: String? (optional text body)
- type: enum PostType { TEXT, IMAGE, YOUTUBE, AUDIO }
- mediaUrl: String? (Cloudinary URL or YouTube URL)
- createdAt: DateTime @default(now())
- reactions: Reaction[]
- comments: Comment[]

**Reaction**
- id: cuid
- postId: String (FK → Post)
- emoji: String (e.g. "❤️")
- name: String (reactor's name)
- createdAt: DateTime

**Comment**
- id: cuid
- postId: String (FK → Post)
- authorName: String
- body: String
- createdAt: DateTime

Run `prisma migrate dev --name init` after creating the schema.

### 2. Environment Variables

Create `.env.local`:
```
DATABASE_URL=<neon postgresql url>
CLOUDINARY_CLOUD_NAME=<value>
CLOUDINARY_API_KEY=<value>
CLOUDINARY_API_SECRET=<value>
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=<value>
```

### 3. Lib Files

**`lib/prisma.ts`** — PrismaClient singleton (standard Next.js pattern)

**`lib/cloudinary.ts`** — configure cloudinary v2 with env vars

**`lib/constants.ts`** — export FAMILY_MEMBERS array (hardcoded names list)

**`lib/validators.ts`** — Zod schemas for:
- CreatePostInput (authorName, content, type, mediaUrl)
- CreateCommentInput (authorName, body)
- CreateReactionInput (emoji, name)

### 4. API Routes

**`app/api/posts/route.ts`**
- GET: return posts paginated (cursor-based on createdAt), newest first, include _count for reactions/comments and all reactions/comments on each post. Accept ?cursor= query param.
- POST: validate with Zod, create post, return created post

**`app/api/posts/[id]/route.ts`**
- GET: single post with all comments and reactions
- DELETE: delete post by id

**`app/api/posts/[id]/react/route.ts`**
- POST: body { emoji, name } — if reaction with same emoji+name exists on post, delete it (toggle); otherwise create it

**`app/api/posts/[id]/comments/route.ts`**
- POST: body { authorName, body } — create comment, return it

**`app/api/media/upload/route.ts`**
- POST: receive FormData with a `file` field. Upload to Cloudinary using the Node SDK (server-side, signed). Return { url, publicId }.

### 5. Components

#### Feed Components

**`components/Feed/PostCard.tsx`**
- Renders any post based on `type` field
- Shows: author name, time ago, content, media (delegated to sub-component), reaction bar, comment count toggle
- Compact by default, expandable for comments

**`components/Feed/YoutubeEmbed.tsx`**
- Accept a YouTube URL, extract video ID (handle youtu.be, youtube.com/watch?v=, youtube.com/shorts/)
- Render `<iframe>` with 16:9 aspect ratio

**`components/Feed/ImagePost.tsx`**
- Show image with rounded corners, full-width in card
- Click to open in lightbox (use a simple CSS overlay)

**`components/Feed/AudioPlayer.tsx`**
- Custom player: play/pause button, progress bar (range input), duration display
- Uses HTML5 `<audio>` under the hood

**`components/Feed/ReactionBar.tsx`**
- Show 5 emoji options: ❤️ 😂 🎉 😢 🙌
- Show count for each emoji that has reactions
- Highlight if current user's name has reacted
- Click to toggle via POST /api/posts/[id]/react

**`components/Feed/CommentThread.tsx`**
- Collapsible thread
- Show existing comments (authorName, body, time)
- Input form at bottom: name (from context) + text → POST /api/posts/[id]/comments

#### Compose Components

**`components/Compose/ComposeBar.tsx`**
- Four buttons: 📝 Text, 🎬 YouTube, 🖼️ Image, 🎙️ Audio
- Clicking opens the relevant sub-form
- Name picker dropdown always visible at top

**`components/Compose/YouTubeInput.tsx`**
- URL text input
- Live preview of embed as user types (debounced 500ms)
- Submit button

**`components/Compose/ImageUploader.tsx`**
- Drag-and-drop zone OR click to browse
- Show preview of selected image
- Upload on submit (not on select)
- Show upload progress

**`components/Compose/AudioRecorder.tsx`**
- "Start Recording" button — request mic permission, start MediaRecorder
- Live recording indicator (pulsing red dot + timer)
- "Stop" → shows playback of recorded audio
- "Re-record" to discard and start over
- "Post" to upload blob to /api/media/upload and create post

#### Shared

**`components/shared/NamePicker.tsx`**
- Dropdown select populated from FAMILY_MEMBERS constant
- Persists selection in localStorage as "famcity_name"
- Used by all compose forms and reaction/comment actions

**`components/shared/Toast.tsx`**
- Simple toast notification (success/error)
- Auto-dismiss after 3 seconds

### 6. Pages

**`app/page.tsx`** (Feed)
- Fetch initial posts server-side (first page)
- Client component handles polling: `setInterval` every 30 seconds to refetch and merge new posts
- Infinite scroll: IntersectionObserver on last card → fetch next page
- Show `<PostCard>` for each post
- FAB (floating action button) → links to /compose

**`app/compose/page.tsx`**
- Full page compose experience
- `<ComposeBar>` at top (type selector + name picker)
- Active form below
- On success → redirect to feed with ?posted=1
- Show success toast on redirect

**`app/posts/[id]/page.tsx`**
- Full post view
- Show post content + full comment thread
- Back button to feed

**`app/layout.tsx`**
- App name "FamCity" in top nav
- Link to /compose
- Global Tailwind styles
- Toast provider

### 7. Design

- Color scheme: warm cream background (#FEFAF6), dark text (#1A1A1A), accent color warm orange (#F97316)
- Font: system font stack (no Google Fonts dependency)
- Cards: white background, subtle shadow, rounded-2xl, padding
- Mobile-first: single column on mobile, max-w-2xl centered on desktop
- Post type badge on each card (color coded)

### 8. Error Handling

- API routes return typed error responses: `{ error: string }` with appropriate HTTP status
- Client components show toast on API error
- AudioRecorder gracefully handles mic permission denial
- ImageUploader validates file type (image/*) and size (max 10MB) client-side before upload

## What NOT to include

- No authentication
- No user accounts or sessions (just the localStorage name)
- No WebSockets (polling only for now)
- No video upload (YouTube URL embed only)
- No tests (this is MVP)
- No Storybook

## Acceptance Criteria

1. Family member can post text in under 30 seconds
2. YouTube URL embed shows video inline in feed
3. Image uploads and displays in feed within 5 seconds
4. Audio records, plays back in recorder, uploads, and plays in feed
5. Emoji reactions toggle correctly per name
6. Comments appear without full page reload
7. Feed auto-refreshes with new posts every 30 seconds
8. Works on mobile Safari (iOS) and Chrome (Android)
9. Deployed to Vercel and accessible via URL
```

---

## How to Use This Prompt

1. Open a new Claude Code session in the `famcity/` directory
2. Paste the prompt above
3. Claude will scaffold the entire project step by step
4. After generation, fill in `.env.local` with real credentials
5. Run `npm install && npx prisma migrate dev && npm run dev`
6. Test each post type locally before deploying

## Credentials You'll Need Before Starting

- **Neon DB**: Create a free project at neon.tech → copy the connection string
- **Cloudinary**: Create a free account at cloudinary.com → copy cloud name, API key, API secret
- **Vercel**: Connect your GitHub repo for one-click deploys
