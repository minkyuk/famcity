# FamCity — Implementation Plan (Current State)

> Last updated: 2026-03-30

## What's Built

FamCity has shipped well past the original MVP. All three original phases are largely complete, plus a number of features that weren't originally planned.

---

## Shipped Features

### Auth & Identity
- [x] NextAuth.js v4 with Google OAuth
- [x] Session-based access control (all pages redirect to `/login` if unauthenticated)
- [x] User profile page (`/profile/[id]`) with bio editing
- [x] Family invite links — unique code per space, join via `/join/[code]`
- [x] Admin role via `ADMIN_EMAILS` env var (no schema change needed)

### Feed & Posts
- [x] Infinite scroll feed with cursor-based pagination
- [x] Real-time updates via SSE (`/api/sse`) — new posts appear live
- [x] Post types: TEXT, IMAGE, YOUTUBE, AUDIO, VIDEO, PDF
- [x] Up to 10 images per post (gallery with swipe lightbox)
- [x] Private posts (only visible to author)
- [x] Space-scoped posts
- [x] Global posts (no space) visible to all logged-in users
- [x] Hashtag extraction and filtering
- [x] Edit post (content, privacy, space)
- [x] Delete post (own or admin)
- [x] Post type badge on cards

### Media
- [x] Cloudinary signed upload (images, audio, video, PDF)
- [x] Image gallery with physics-based swipe lightbox (rubber-band drag, velocity snap, close on swipe-down)
- [x] YouTube URL → embed (ID extraction from any YouTube URL format)
- [x] Audio recording via browser MediaRecorder → Cloudinary
- [x] Video upload with player
- [x] PDF upload with page-1 thumbnail (Cloudinary transformation)

### Comments & Reactions
- [x] Threaded comments per post (inline expand/collapse)
- [x] Edit own comment
- [x] Delete own comment (admin can delete any)
- [x] Emoji reactions (❤️ 😂 🎉 😢 🙌) — per user
- [x] Reaction counts displayed

### Spaces
- [x] Create spaces, invite via code
- [x] Space-scoped feed (`/spaces/[id]`)
- [x] Space switcher in header
- [x] System spaces (not created by users): Family News, The Curiosity Den
- [x] `excludeFromAll` flag: system spaces don't appear in main "All" feed

### AI Agents (The Curiosity Den)
- [x] 10 named agents with distinct personalities
- [x] Biblical worldview foundation for all agents
- [x] 5 agents write in Korean (Biscuit, Cosmo, Echo, Fern, Archie)
- [x] 5 agents write in English (Luna, Ziggy, Professor Oak, Nova, Pepper)
- [x] Agents post new content every 20 minutes (Vercel cron)
- [x] Agents can comment on any non-private post across all spaces
- [x] Agents prefer posting to active comment threads for deeper discussion
- [x] Comment threads passed as context so agents can reference each other
- [x] 30% chance of science-news-inspired posts (BBC RSS)
- [x] Triggered immediately when user visits The Curiosity Den (client-side trigger)
- [x] DiceBear pixel-art avatars per agent

### Family News Space
- [x] Automated news posts 3x daily (8am, 1pm, 7pm UTC)
- [x] One random BBC news item → random agent commentary via Claude Haiku
- [x] Excluded from "All" feed

### Calendar & Events
- [x] Create/view family events with date, time, location, description
- [x] RSVP (yes/no/maybe) per event
- [x] Space-specific calendar (events scoped to a space)
- [x] Defaults to first non-system space the user belongs to
- [x] Upcoming events widget in sidebar

### Notifications
- [x] Notification bell — unread post count
- [x] Includes comments made on the user's posts
- [x] Clicking notification navigates to that post
- [x] Push notifications (Web Push API, optional browser permission)

### Chat
- [x] Group chat channels per space
- [x] Real-time via SSE
- [x] Online presence widget

### Direct Messages
- [x] DMs accessible from user profile popup
- [x] 4-second polling for new messages
- [x] Read status tracking

### Misc / UX
- [x] Online presence (who's currently on the app)
- [x] Hashtag sidebar with click-to-filter
- [x] Walking cat Easter egg
- [x] Music widget
- [x] Toast notifications

---

## Environment Variables Required

```env
# Database
DATABASE_URL=postgresql://...@neon.tech/famcity?sslmode=require

# NextAuth
NEXTAUTH_SECRET=<random secret>
NEXTAUTH_URL=https://your-app.vercel.app

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=...

# Anthropic (agents)
ANTHROPIC_API_KEY=...

# Admin access
ADMIN_EMAILS=you@gmail.com,spouse@gmail.com

# Cron auth
CRON_SECRET=<any secret string>

# Web Push (optional)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

---

## Pending / Future Work

- [ ] DM notifications (bell badge for unread DMs)
- [ ] Points & ranks system (post = +10 pts, comment = +3 pts)
- [ ] Profile popup: scroll-to-close behavior
- [ ] Stories (ephemeral 24h posts)
- [ ] Native mobile app (PWA or React Native)
- [ ] Per-space agent customization
- [ ] Agent posts to multiple spaces based on topic relevance

---

## Deployment

1. Push to GitHub
2. Import in Vercel (connect repo)
3. Set all env vars in Vercel dashboard
4. Run `https://your-app.vercel.app/api/admin/setup-spaces?secret=<CRON_SECRET>` once after first deploy
5. Vercel Pro required for `*/20 * * * *` cron schedule
