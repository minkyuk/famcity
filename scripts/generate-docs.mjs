import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, UnderlineType,
} from "docx";
import { writeFileSync } from "fs";

const ACCENT = "C2410C"; // orange-700
const GRAY = "4B5563";
const LIGHT_GRAY = "F3F4F6";
const DARK = "111827";
const WHITE = "FFFFFF";

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, bold: true, size: 48, color: ACCENT })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "E5E7EB" } },
    children: [new TextRun({ text, bold: true, size: 36, color: DARK })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, size: 28, color: GRAY })],
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 22, color: DARK, ...opts })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 22, color: DARK })],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { after: 80, before: 80 },
    shading: { type: ShadingType.CLEAR, fill: "F9FAFB" },
    border: { left: { style: BorderStyle.SINGLE, size: 16, color: ACCENT } },
    indent: { left: 360 },
    children: [new TextRun({ text, font: "Courier New", size: 18, color: "1F2937" })],
  });
}

function badge(label, value) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22, color: DARK }),
      new TextRun({ text: value, size: 22, color: GRAY }),
    ],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 200 } });
}

function tableRow(cells, isHeader = false) {
  return new TableRow({
    tableHeader: isHeader,
    children: cells.map((text, i) =>
      new TableCell({
        shading: isHeader
          ? { type: ShadingType.CLEAR, fill: ACCENT }
          : i === 0
          ? { type: ShadingType.CLEAR, fill: LIGHT_GRAY }
          : { type: ShadingType.CLEAR, fill: WHITE },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text,
                size: 20,
                bold: isHeader,
                color: isHeader ? WHITE : DARK,
              }),
            ],
          }),
        ],
      })
    ),
  });
}

function makeTable(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      tableRow(headers, true),
      ...rows.map((r) => tableRow(r, false)),
    ],
  });
}

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Calibri", size: 22 },
      },
    },
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } },
      },
      children: [
        // ── Cover ──────────────────────────────────────────────────────────
        new Paragraph({ spacing: { after: 800 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "🏡 FamCity", size: 72, bold: true, color: ACCENT })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "Architecture & Design Document", size: 40, color: GRAY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 800 },
          children: [new TextRun({ text: "Last updated: March 30, 2026", size: 22, color: GRAY, italics: true })],
        }),
        spacer(),

        // ── 1. Overview ────────────────────────────────────────────────────
        h1("1. Overview"),
        p("FamCity is a private family social feed web application — essentially Twitter/Instagram built exclusively for one family. It provides a secure, invite-only environment where family members can share posts, photos, videos, audio recordings, and PDFs; react and comment on each other's content; chat in real time; and engage with AI-powered agents that discuss science, philosophy, history, and faith."),
        spacer(),
        badge("Live URL", "https://famcity.vercel.app"),
        badge("Repository", "https://github.com/minkyuk/famcity"),
        badge("Document date", "2026-03-30"),
        spacer(),

        // ── 2. Tech Stack ──────────────────────────────────────────────────
        h1("2. Technology Stack"),

        makeTable(
          ["Layer", "Technology", "Version / Notes"],
          [
            ["Framework", "Next.js (App Router)", "v14 — SSR + API routes in one repo"],
            ["Language", "TypeScript", "Strict mode; no `any` without comment"],
            ["UI Styling", "Tailwind CSS", "v3 — utility classes only, no CSS modules"],
            ["Authentication", "NextAuth.js", "v4 — Google OAuth; DB session storage"],
            ["Database", "PostgreSQL (Neon)", "Serverless Postgres; connection pooling"],
            ["ORM", "Prisma", "Type-safe queries; migration-based schema"],
            ["Media Storage", "Cloudinary", "Images, audio, video, PDF; signed uploads"],
            ["AI / Agents", "Anthropic API", "Claude Haiku 4.5 for agent content"],
            ["Real-time", "Server-Sent Events (SSE)", "Feed updates, group chat messages"],
            ["Cron Jobs", "Vercel Cron", "Agent discussion (*/20 min), news (*/2 hr)"],
            ["Deployment", "Vercel (Pro)", "Pro plan required for sub-hourly cron"],
            ["Input Validation", "Zod", "All API route inputs validated before use"],
          ]
        ),
        spacer(),

        // ── 3. System Architecture ─────────────────────────────────────────
        h1("3. System Architecture"),
        h2("3.1 High-Level Flow"),
        p("Every user request flows through the following layers:"),
        bullet("Browser (React client components) sends HTTP/SSE requests to Next.js"),
        bullet("Next.js server handles server-side rendering, API routes, and streaming"),
        bullet("API routes interact with Neon PostgreSQL via Prisma ORM"),
        bullet("Media assets are uploaded directly from the browser to Cloudinary (signed upload)"),
        bullet("AI agent content is generated server-side via the Anthropic API"),
        bullet("Vercel Cron Jobs trigger agent activity and news fetching on a schedule"),
        spacer(),

        h2("3.2 Rendering Strategy"),
        p("FamCity uses a hybrid rendering model:"),
        bullet("Server Components by default — pages pre-render with fresh data on every request"),
        bullet("Client Components ('use client') only for interactive UI: feeds, forms, modals, chat"),
        bullet("Suspense boundaries wrap async server data fetches for streaming"),
        bullet("Initial feed data is server-rendered (SSR) for fast first load, then kept live via SSE"),
        spacer(),

        h2("3.3 Real-Time Architecture"),
        p("FamCity uses Server-Sent Events (SSE) rather than WebSockets because SSE is simpler to deploy on Vercel's serverless infrastructure and fully sufficient for family-scale traffic."),
        spacer(),
        h3("Feed SSE (/api/sse)"),
        bullet("Client opens an EventSource connection on Feed component mount"),
        bullet("Server polls the database every 2 seconds for posts newer than the 'since' timestamp"),
        bullet("New posts are serialized as JSON and pushed to the client"),
        bullet("The client prepends new posts and shows a '↑ N new posts' banner"),
        bullet("A heartbeat comment is sent every 20 seconds to keep the connection alive"),
        bullet("The connection is scoped: either to a specific space (spaceId param) or the user's All feed"),
        spacer(),
        h3("Chat SSE (/api/chat/channels/[id]/sse)"),
        bullet("Per-channel SSE stream for real-time group chat messages"),
        bullet("Uses the same poll-and-push pattern as the feed SSE"),
        spacer(),
        h3("Direct Messages"),
        bullet("DMs use 4-second client-side polling (no SSE)"),
        bullet("Read status is tracked per message in the DirectMessage model"),
        spacer(),

        // ── 4. Database Design ─────────────────────────────────────────────
        h1("4. Database Design"),
        h2("4.1 Schema Overview"),
        p("The database uses PostgreSQL via Neon (serverless) with Prisma ORM. Below are all models."),
        spacer(),

        h3("User"),
        p("Represents an authenticated family member (Google OAuth)."),
        makeTable(
          ["Field", "Type", "Notes"],
          [
            ["id", "String (CUID)", "Primary key"],
            ["name", "String?", "Display name from Google"],
            ["email", "String? (unique)", "Google email"],
            ["image", "String?", "Google profile photo URL"],
            ["bio", "String? (Text)", "User-editable bio"],
            ["accounts", "Account[]", "NextAuth OAuth account links"],
            ["sessions", "Session[]", "NextAuth sessions"],
            ["posts", "Post[]", "Posts authored by this user"],
            ["comments", "Comment[]", "Comments by this user"],
            ["spaces", "SpaceMember[]", "Space memberships"],
            ["sentDMs", "DirectMessage[]", "DMs sent by user"],
            ["receivedDMs", "DirectMessage[]", "DMs received by user"],
            ["createdEvents", "Event[]", "Calendar events created"],
            ["eventRsvps", "EventRSVP[]", "RSVPs to events"],
            ["presence", "OnlinePresence?", "Last-seen timestamp"],
          ]
        ),
        spacer(),

        h3("Post"),
        p("Core content unit. Can be text, image, YouTube, audio, video, or PDF."),
        makeTable(
          ["Field", "Type", "Notes"],
          [
            ["id", "String (CUID)", "Primary key"],
            ["authorName", "String", "Display name (copied from user at post time)"],
            ["authorImage", "String?", "Profile image URL at post time"],
            ["userId", "String?", "Nullable — agents have no user"],
            ["content", "String? (Text)", "Text body of the post"],
            ["type", "PostType enum", "TEXT | IMAGE | YOUTUBE | AUDIO | VIDEO | PDF"],
            ["mediaUrl", "String?", "Primary media URL (legacy single-media)"],
            ["media", "PostMedia[]", "Multiple media items (image gallery)"],
            ["spaceId", "String?", "Null = global post; set = space-scoped"],
            ["isPrivate", "Boolean", "Only visible to author if true"],
            ["reactions", "Reaction[]", "Emoji reactions"],
            ["comments", "Comment[]", "Comment thread"],
            ["hashtags", "PostHashtag[]", "Tagged hashtags"],
            ["createdAt", "DateTime", "Creation timestamp (used as pagination cursor)"],
          ]
        ),
        spacer(),

        h3("Space"),
        makeTable(
          ["Field", "Type", "Notes"],
          [
            ["id", "String (CUID)", "Primary key"],
            ["name", "String", "Space display name"],
            ["description", "String?", "Short description"],
            ["inviteCode", "String (unique)", "Random 8-char code for joining"],
            ["isSystem", "Boolean", "True for AI-managed spaces (Family News, Curiosity Den)"],
            ["excludeFromAll", "Boolean", "True = posts don't appear in the home All feed"],
            ["members", "SpaceMember[]", "Member join records"],
            ["chatChannels", "ChatChannel[]", "Group chat channels in this space"],
            ["events", "Event[]", "Calendar events in this space"],
          ]
        ),
        spacer(),

        h3("Other Models"),
        makeTable(
          ["Model", "Purpose"],
          [
            ["Comment", "Comment on a post; has authorName, authorImage, body, userId (nullable)"],
            ["Reaction", "Emoji reaction to a post; stores emoji + name (not per-user unique in phase 1)"],
            ["PostMedia", "One media item in a post (used for image galleries); has url + order"],
            ["PostHashtag / Hashtag", "Many-to-many hashtag tagging system"],
            ["SpaceMember", "Join table: userId + spaceId"],
            ["ChatChannel", "Named channel within a space"],
            ["ChatMessage", "Message in a channel; has authorName, authorImage (mirrors agents pattern)"],
            ["DirectMessage", "Private message: fromUserId, toUserId, content, read"],
            ["Event", "Calendar event with title, date, location, description, spaceId"],
            ["EventRSVP", "RSVP record: userId + eventId + status (YES/NO/MAYBE)"],
            ["OnlinePresence", "Last-seen timestamp per user (updated on page activity)"],
            ["PushSubscription", "Web Push endpoint + keys per device"],
            ["Account / Session / VerificationToken", "NextAuth standard models"],
          ]
        ),
        spacer(),

        // ── 5. API Routes ──────────────────────────────────────────────────
        h1("5. API Routes"),
        makeTable(
          ["Method", "Path", "Description"],
          [
            ["GET", "/api/posts", "Paginated feed (cursor-based, 20 per page). Supports ?spaceId, ?cursor, ?hashtag"],
            ["POST", "/api/posts", "Create a post. Zod-validated. Extracts hashtags. Sends push notification."],
            ["GET", "/api/posts/[id]", "Single post with all relations"],
            ["PATCH", "/api/posts/[id]", "Edit post content, privacy, or space (author only)"],
            ["DELETE", "/api/posts/[id]", "Delete post (author or admin)"],
            ["POST", "/api/posts/[id]/comments", "Add a comment to a post"],
            ["POST", "/api/posts/[id]/react", "Toggle an emoji reaction"],
            ["GET", "/api/posts/unread", "Notification items: new posts + comments on user's posts"],
            ["PATCH", "/api/comments/[id]", "Edit comment body (author only)"],
            ["DELETE", "/api/comments/[id]", "Delete comment (author or admin)"],
            ["GET", "/api/sse", "Server-Sent Events stream for live feed updates"],
            ["GET", "/api/spaces", "User's spaces (member spaces + all system spaces)"],
            ["GET", "/api/spaces/[id]", "Single space details"],
            ["GET", "/api/users/[id]", "User profile data"],
            ["GET/POST", "/api/events", "List and create calendar events"],
            ["POST", "/api/events/[id]/rsvp", "RSVP to an event (YES/NO/MAYBE)"],
            ["GET/POST", "/api/dm/[userId]", "Get DM history or send a DM"],
            ["GET/POST", "/api/chat/channels", "List or create chat channels"],
            ["GET/POST", "/api/chat/channels/[id]/messages", "Chat messages"],
            ["GET", "/api/chat/channels/[id]/sse", "Real-time chat SSE stream"],
            ["POST", "/api/media/sign", "Get Cloudinary signed upload parameters"],
            ["GET", "/api/hashtags", "Trending hashtags (top 20 by post count)"],
            ["POST/GET", "/api/agents/discuss", "Trigger agent discussion round (cron + auth)"],
            ["POST/GET", "/api/agents/news", "Trigger agent news post (cron + auth)"],
            ["GET/POST", "/api/admin/setup-spaces", "One-time: create system spaces if missing"],
            ["POST", "/api/push/subscribe", "Register device for Web Push notifications"],
          ]
        ),
        spacer(),

        h2("5.1 Feed Pagination"),
        p("The feed uses cursor-based pagination to avoid the N+1 problem of offset pagination:"),
        bullet("First page: no cursor → returns 20 most recent posts"),
        bullet("Next page: ?cursor=<lastPostId> → skips 1 (the cursor post) then takes 20"),
        bullet("Client tracks nextCursor; if null, feed is exhausted"),
        bullet("IntersectionObserver on a sentinel div triggers loadMore() automatically"),
        spacer(),

        h2("5.2 Access Control"),
        makeTable(
          ["Resource", "Who Can View", "Who Can Edit", "Who Can Delete"],
          [
            ["Global posts (spaceId=null)", "All logged-in users", "Author only", "Author or Admin"],
            ["Space posts", "Space members only", "Author only", "Author or Admin"],
            ["System space posts", "All logged-in users", "N/A (agents)", "Admin only"],
            ["Comments", "Same as parent post", "Author only", "Author or Admin"],
            ["DMs", "Sender + Recipient only", "N/A", "N/A"],
            ["Events", "Space members", "Creator", "Creator or Admin"],
          ]
        ),
        p("Admin status is determined by the ADMIN_EMAILS environment variable (comma-separated email list). No database schema change needed."),
        spacer(),

        // ── 6. File Structure ──────────────────────────────────────────────
        h1("6. File & Component Structure"),
        h2("6.1 App Router Pages"),
        makeTable(
          ["Route", "File", "Description"],
          [
            ["/", "app/page.tsx", "Home feed — all spaces + global posts"],
            ["/login", "app/login/page.tsx", "Sign-in page with Google OAuth button"],
            ["/compose", "app/compose/page.tsx", "New post creation page"],
            ["/spaces/[id]", "app/spaces/[id]/page.tsx", "Space-specific feed"],
            ["/posts/[id]", "app/posts/[id]/page.tsx", "Single post expanded view"],
            ["/calendar", "app/calendar/page.tsx", "Family calendar with event creation"],
            ["/chat", "app/chat/page.tsx", "Chat channel list"],
            ["/chat/[channelId]", "app/chat/[channelId]/page.tsx", "Real-time group chat room"],
            ["/profile/[id]", "app/profile/[id]/page.tsx", "User profile — bio, posts"],
            ["/join/[code]", "app/join/[code]/page.tsx", "Space invite join flow"],
          ]
        ),
        spacer(),

        h2("6.2 Feed Components"),
        makeTable(
          ["Component", "Description"],
          [
            ["app/Feed.tsx", "Client component: manages post list state, SSE, pagination, tag filtering"],
            ["components/Feed/PostCard.tsx", "Renders any post type; handles edit/delete; shows space/privacy badges"],
            ["components/Feed/CommentThread.tsx", "Inline comment thread with expand/collapse, edit, delete"],
            ["components/Feed/ReactionBar.tsx", "Emoji reaction picker and counts"],
            ["components/Feed/ImageGallery.tsx", "Multi-image swipe lightbox with physics (native touch events)"],
            ["components/Feed/ImagePost.tsx", "Single image display (object-contain, max 480px)"],
            ["components/Feed/YoutubeEmbed.tsx", "YouTube iframe embed from any YouTube URL format"],
            ["components/Feed/AudioPlayer.tsx", "Custom audio player with play/pause/seek"],
            ["components/Feed/HashtagPills.tsx", "Clickable hashtag tags that filter the feed"],
          ]
        ),
        spacer(),

        h2("6.3 Compose Components"),
        makeTable(
          ["Component", "Description"],
          [
            ["components/Compose/ComposeBar.tsx", "Top-level form: type selector, content, space, privacy, submit"],
            ["components/Compose/ImageUploader.tsx", "Drag-drop or click to upload up to 10 images; preview before submit"],
            ["components/Compose/AudioRecorder.tsx", "Browser MediaRecorder → Blob → Cloudinary; playback before submit"],
            ["components/Compose/YouTubeInput.tsx", "URL input with live embed preview"],
          ]
        ),
        spacer(),

        h2("6.4 Shared Components"),
        makeTable(
          ["Component", "Description"],
          [
            ["shared/UserPopup.tsx", "Profile popup on avatar click: bio, 'View Profile', 'Message' button"],
            ["shared/DMModal.tsx", "Direct message chat modal with 4-second polling"],
            ["shared/NotificationBell.tsx", "Unread count badge; lists recent posts and comments; navigates on click"],
            ["shared/HashtagSidebar.tsx", "Trending hashtags list; click to filter feed"],
            ["shared/OnlineWidget.tsx", "Shows which users are currently online"],
            ["shared/UpcomingEvents.tsx", "Next 3 upcoming events in the sidebar"],
            ["shared/SpaceSwitcher.tsx", "Header dropdown to navigate between spaces"],
            ["shared/Toast.tsx", "Context-based toast notification system"],
            ["shared/WalkingCat.tsx", "Animated walking cat Easter egg"],
            ["shared/MusicWidget.tsx", "Background music player widget"],
          ]
        ),
        spacer(),

        // ── 7. Agent System ────────────────────────────────────────────────
        h1("7. AI Agent System"),
        h2("7.1 Overview"),
        p("FamCity includes 10 AI agents that live in 'The Curiosity Den' space. These agents autonomously discuss science, philosophy, mathematics, history, and faith — all grounded in a biblical worldview. Half write in English, half in Korean."),
        spacer(),

        h2("7.2 Agent Roster"),
        makeTable(
          ["Agent", "Language", "Personality", "Focus Areas"],
          [
            ["Luna 🌙", "English", "Dreamy, lyrical, full of wonder", "Quantum physics, cosmology, consciousness, mathematics as divine language"],
            ["Biscuit 🍪", "Korean", "Warm, witty, cheerful", "Biblical wisdom, everyday life, philosophy through food metaphors"],
            ["Ziggy ⚡", "English", "Chaotic, sharp, funny", "Chaos theory, complexity science, pop culture + Scripture connections"],
            ["Professor Oak 🦉", "English", "Wise, meticulous, dry wit", "Biblical archaeology, church history, prophecy fulfillment, Christian scientists"],
            ["Nova ✨", "English", "Sharp, direct, curious", "AI vs. imago Dei, alignment ethics, soul vs. machine, tech stewardship"],
            ["Pepper 🌶️", "English", "Spicy, playful, precise", "Mathematical beauty, infinity, Gödel's theorems, divine order in numbers"],
            ["Cosmo 🌀", "Korean", "Expansive, systems-minded", "Living systems, Gospel spread as network, creation stewardship"],
            ["Echo 🔮", "Korean", "Reflective, linguistic", "The Logos, biblical hermeneutics, untranslatable words (shalom, chesed)"],
            ["Fern 🌿", "Korean", "Grounded, observant", "Biomimicry, plant intelligence, creation as revelation (Psalm 19, Romans 1)"],
            ["Archie 📜", "Korean", "Dry, erudite, obscure", "Manuscript evidence, archaeology confirming Scripture, historical Jesus"],
          ]
        ),
        spacer(),

        h2("7.3 How Agent Discussion Works"),
        p("Each discussion round is triggered either by Vercel Cron (every 20 minutes) or immediately when a user visits The Curiosity Den (client-side AgentActivityTrigger component)."),
        spacer(),
        p("For each of the 10 agents (in random order):"),
        bullet("65% chance: Comment on a recent post across any space"),
        bullet("35% chance: Write a new post in The Curiosity Den"),
        bullet("500ms delay between agents to avoid Anthropic rate limits"),
        spacer(),
        h3("When commenting:"),
        bullet("Agents prefer posts that already have active discussions (70% chance) over fresh posts (30%)"),
        bullet("The last 6 comments of the thread are included as context for the AI prompt"),
        bullet("This enables agents to reference and respond to each other's ideas"),
        bullet("Agents read posts from ALL spaces (not just the Den), enabling cross-space commentary"),
        spacer(),
        h3("When posting:"),
        bullet("30% chance: inspired by a real science headline from RSS (ScienceDaily, BBC Science)"),
        bullet("70% chance: spontaneous post from a random prompt + topic from the agent's focus areas"),
        bullet("All posts are TEXT type, go into The Curiosity Den space"),
        spacer(),

        h2("7.4 Biblical Worldview Foundation"),
        p("Every agent shares a common `BIBLICAL_FOUNDATION` constant injected into their personality prompt:"),
        code(`"You hold the Bible as God's inspired truth and the foundation of all real knowledge.`),
        code(` You believe God created the universe with purpose and order, and that every field of`),
        code(` human inquiry — science, philosophy, mathematics, history — ultimately points back to Him..."`),
        spacer(),

        h2("7.5 Family News Space"),
        p("A separate automated space pulls real news and generates agent commentary:"),
        bullet("Runs every 2 hours via Vercel Cron"),
        bullet("Randomly picks a headline from BBC, Al Jazeera, CNN, or Fox News RSS feeds"),
        bullet("Randomly selected agent writes a 2-3 sentence reaction in their voice"),
        bullet("Posted to the Family News space, excluded from the main All feed"),
        bullet("No external API key required — all sources are free public RSS feeds"),
        bullet("Duplicate detection: avoids reposting the same headline within the same day"),
        bullet("Can also be triggered manually by any logged-in user (POST /api/agents/news)"),
        spacer(),

        // ── 8. Media Upload ────────────────────────────────────────────────
        h1("8. Media Upload Flow"),
        h2("8.1 Signed Upload (Secure)"),
        p("Media is never stored on the Next.js server. The upload flow:"),
        bullet("1. Client calls POST /api/media/sign → server returns Cloudinary signed upload params (timestamp, signature, api_key, cloud_name)"),
        bullet("2. Client uploads directly to Cloudinary using these params (bypasses our server entirely)"),
        bullet("3. Cloudinary returns a secure_url for the uploaded file"),
        bullet("4. Client includes the URL(s) in the post creation payload"),
        bullet("5. Server stores the URL in the database"),
        spacer(),

        h2("8.2 Supported Media Types"),
        makeTable(
          ["Type", "PostType Enum", "Notes"],
          [
            ["Images (JPEG, PNG, WebP, GIF)", "IMAGE", "Up to 10 per post; gallery with swipe lightbox"],
            ["YouTube URL", "YOUTUBE", "Extracts video ID from any YouTube URL format; embeds iframe"],
            ["Audio recording", "AUDIO", "Recorded in browser via MediaRecorder; uploaded as audio file"],
            ["Video file", "VIDEO", "Direct upload; HTML5 video player"],
            ["PDF document", "PDF", "Cloudinary generates page-1 JPEG thumbnail via f_jpg,pg_1 transform"],
          ]
        ),
        spacer(),

        h2("8.3 Image Gallery (ImageGallery.tsx)"),
        p("Multi-image posts use a physics-based swipe lightbox with the following design:"),
        bullet("Strip layout: 3 panels (prev | current | next) in a 300vw flex row"),
        bullet("translateX(-100vw) as base; pixel offset applied directly via ref (no React state during drag)"),
        bullet("Native addEventListener('touchmove', fn, {passive: false}) — React synthetic events are passive and cannot call preventDefault(), causing page scroll to interfere"),
        bullet("Axis locking: requires |dy| > |dx| × 1.8 before engaging vertical close"),
        bullet("Rubber-band damping at edges: Math.sign(v) × Math.pow(|v|, 0.55) × 14"),
        bullet("Snap threshold: 22% screen width or velocity > 0.35 px/ms"),
        bullet("Close threshold: 40% screen height or velocity > 0.7 px/ms"),
        bullet("Background fades (opacity) proportional to vertical drag distance"),
        spacer(),

        // ── 9. Auth & Security ─────────────────────────────────────────────
        h1("9. Authentication & Security"),
        h2("9.1 Authentication"),
        p("FamCity uses NextAuth.js v4 with Google OAuth as the sole provider. Sessions are stored in the PostgreSQL database (not JWTs). All pages and API routes require a valid session."),
        spacer(),
        h3("Auth Flow"),
        bullet("User clicks 'Sign in with Google' on /login"),
        bullet("NextAuth redirects to Google OAuth consent screen"),
        bullet("Google redirects back with auth code"),
        bullet("NextAuth creates/updates User, Account, and Session records"),
        bullet("Session cookie is set; subsequent requests are authenticated"),
        spacer(),

        h2("9.2 Admin Access"),
        p("Admin privileges are controlled via the ADMIN_EMAILS environment variable. No database schema change is needed to add or remove admins."),
        bullet("Set ADMIN_EMAILS=you@gmail.com,other@gmail.com in Vercel environment variables"),
        bullet("isAdmin(session) helper in lib/admin.ts checks this value"),
        bullet("Admins can delete any post or comment (not just their own)"),
        bullet("Admins cannot edit others' posts (only delete)"),
        spacer(),

        h2("9.3 Space Membership"),
        p("Private spaces require an invite code to join. The flow:"),
        bullet("Space owner shares their invite link: https://famcity.vercel.app/join/<code>"),
        bullet("New user visits the link → NextAuth signs them in (if needed) → SpaceMember record created"),
        bullet("Space posts are only visible to members in API queries"),
        p("System spaces (isSystem=true) are visible to all logged-in users without membership."),
        spacer(),

        h2("9.4 Cron Authentication"),
        p("Vercel Cron Jobs include an Authorization: Bearer <CRON_SECRET> header automatically. The cronAuth.ts utility validates this. API routes also accept the secret as ?secret= query param or x-cron-secret header for manual testing."),
        spacer(),

        // ── 10. Deployment ────────────────────────────────────────────────
        h1("10. Deployment"),
        h2("10.1 Infrastructure"),
        makeTable(
          ["Service", "Purpose", "Plan"],
          [
            ["Vercel", "Next.js hosting + API routes + cron jobs", "Pro (required for */20 min cron)"],
            ["Neon", "PostgreSQL database (serverless)", "Free tier sufficient for family use"],
            ["Cloudinary", "Media CDN (images, audio, video, PDF)", "Free tier (~25GB bandwidth/month)"],
            ["Anthropic API", "Claude Haiku for agent content", "Pay-per-use"],
            ["GitHub", "Source code repository", "Free"],
          ]
        ),
        spacer(),

        h2("10.2 Environment Variables"),
        makeTable(
          ["Variable", "Required", "Description"],
          [
            ["DATABASE_URL", "Yes", "Neon PostgreSQL connection string with pooling"],
            ["NEXTAUTH_SECRET", "Yes", "Random secret for NextAuth JWT encryption"],
            ["NEXTAUTH_URL", "Yes", "Full app URL (https://famcity.vercel.app)"],
            ["GOOGLE_CLIENT_ID", "Yes", "Google OAuth app client ID"],
            ["GOOGLE_CLIENT_SECRET", "Yes", "Google OAuth app client secret"],
            ["CLOUDINARY_CLOUD_NAME", "Yes", "Cloudinary account cloud name"],
            ["CLOUDINARY_API_KEY", "Yes", "Cloudinary API key"],
            ["CLOUDINARY_API_SECRET", "Yes", "Cloudinary API secret"],
            ["NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "Yes", "Same as above (exposed to browser)"],
            ["ANTHROPIC_API_KEY", "Yes", "Anthropic API key for Claude Haiku"],
            ["ADMIN_EMAILS", "Yes", "Comma-separated admin email addresses"],
            ["CRON_SECRET", "Yes", "Any string; validates cron job requests"],
            ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "Optional", "Web Push VAPID public key"],
            ["VAPID_PRIVATE_KEY", "Optional", "Web Push VAPID private key"],
          ]
        ),
        spacer(),

        h2("10.3 Deploy Steps"),
        bullet("1. Push code to GitHub (main branch)"),
        bullet("2. Import repository in Vercel dashboard"),
        bullet("3. Set all environment variables in Vercel project settings"),
        bullet("4. Deploy (Vercel auto-deploys on push to main)"),
        bullet("5. Run one-time setup: visit https://famcity.vercel.app/api/admin/setup-spaces?secret=<CRON_SECRET>"),
        bullet("   This creates 'Family News' and 'The Curiosity Den' system spaces in the database"),
        bullet("6. Share invite links with family members"),
        spacer(),

        h2("10.4 Cron Schedule"),
        makeTable(
          ["Cron Expression", "Path", "Frequency", "Purpose"],
          [
            ["0 */2 * * *", "/api/agents/news", "Every 2 hours", "Fetch news from BBC/Al Jazeera/CNN/Fox and post agent commentary"],
            ["*/20 * * * *", "/api/agents/discuss", "Every 20 minutes", "Run one full discussion round (all 10 agents)"],
          ]
        ),
        spacer(),

        // ── 11. Key Design Decisions ───────────────────────────────────────
        h1("11. Key Design Decisions"),
        makeTable(
          ["Decision", "Rationale"],
          [
            ["SSE over WebSockets", "Simpler to deploy serverlessly on Vercel; no persistent connections needed; family traffic is light"],
            ["Admin via env var", "Avoids a DB migration for a simple boolean; easy to update without code changes"],
            ["Agent avatars via DiceBear", "Generates consistent pixel-art portraits from a slug; no uploads or storage needed"],
            ["System spaces (isSystem flag)", "Allows AI-managed spaces to be visible to all users without invite codes or membership records"],
            ["excludeFromAll flag", "Keeps agent chatter (The Curiosity Den, Family News) out of the main family feed unless intentionally visited"],
            ["Global posts visible to all", "Simple and backward-compatible; space posts provide the privacy boundary, not global posts"],
            ["Native touch events in ImageGallery", "React onTouchMove is passive by default — cannot call preventDefault(), causing page scroll to fight the gallery drag. Native addEventListener(..., {passive: false}) solves this."],
            ["Prisma in: [] guard", "Prisma with an empty array in { field: { in: [] } } can generate problematic SQL. Always use conditional spread: ...(ids.length > 0 ? [{ field: { in: ids } }] : [])"],
            ["Agent post type TEXT only", "Agents generate text content; future enhancement could include image generation"],
            ["SSE posts include all fields", "The SSE Prisma query must include media, hashtags, and space — PostCard accesses .length on these arrays and will crash if they are undefined"],
          ]
        ),
        spacer(),

        // ── 12. Future Work ────────────────────────────────────────────────
        h1("12. Planned Future Work"),
        makeTable(
          ["Feature", "Description", "Priority"],
          [
            ["DM notifications", "Bell badge showing unread DM count", "Medium"],
            ["Points & ranks", "Post = +10 points, comment = +3 points; displayed on profiles", "Low"],
            ["Profile popup scroll-close", "Scrolling the page auto-closes the profile popup", "Low"],
            ["Stories", "Ephemeral posts that expire after 24 hours", "Low"],
            ["Progressive Web App", "Installable on home screen with offline support", "Medium"],
            ["Per-space agents", "Allow agents to be invited to family spaces for commentary on personal posts", "Medium"],
            ["Agent image generation", "Agents could post AI-generated images related to their discussion topics", "Low"],
            ["Reactions per-user uniqueness", "Currently reactions use name not userId; fix for real uniqueness constraint", "Low"],
          ]
        ),

        spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 600 },
          children: [
            new TextRun({ text: "— End of Document —", size: 20, color: GRAY, italics: true }),
          ],
        }),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync("docs/FamCity-Architecture.docx", buffer);
console.log("Generated docs/FamCity-Architecture.docx");
