# FamCity — Setup Guide

## Prerequisites

- Node.js 18+
- A Neon DB account (free): https://neon.tech
- A Cloudinary account (free): https://cloudinary.com
- A Vercel account (free): https://vercel.com

---

## Step 1: Create the Next.js Project

```bash
npx create-next-app@latest famcity \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*"

cd famcity
```

## Step 2: Install Dependencies

```bash
npm install prisma @prisma/client zod date-fns clsx cloudinary
npm install -D @types/node
```

## Step 3: Set Up Neon Database

1. Go to https://neon.tech and create a new project named `famcity`
2. Copy the connection string (looks like `postgresql://user:pass@host/famcity?sslmode=require`)
3. In Neon dashboard, also copy the **pooled connection string** (for API routes)

## Step 4: Set Up Cloudinary

1. Go to https://cloudinary.com → Dashboard
2. Note your **Cloud Name**, **API Key**, **API Secret**
3. Go to Settings → Upload → Add upload preset
   - Name it `famcity_unsigned`
   - Signing mode: **Unsigned** (for direct browser uploads if needed)
   - Folder: `famcity`
   - Save

## Step 5: Configure Environment Variables

Create `.env.local` in your project root:

```bash
# Database
DATABASE_URL="postgresql://..."           # Direct connection (for migrations)
DATABASE_URL_UNPOOLED="postgresql://..."  # Pooled (for API routes on Vercel)

# Cloudinary
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="your_cloud_name"
```

## Step 6: Initialize Prisma

```bash
npx prisma init
# Edit prisma/schema.prisma (see architecture.md for full schema)
npx prisma migrate dev --name init
npx prisma generate
```

## Step 7: Run Locally

```bash
npm run dev
```

Open http://localhost:3000 — you should see the empty feed.

## Step 8: Deploy to Vercel

```bash
# Push to GitHub first
git init && git add . && git commit -m "initial commit"
gh repo create famcity --private --push
```

Then in Vercel:
1. Import the GitHub repo
2. Add all environment variables from `.env.local`
3. Deploy

Share the Vercel URL with your family.

---

## Adding Family Member Names

Edit `lib/constants.ts`:

```ts
export const FAMILY_MEMBERS = [
  "Mom",
  "Dad",
  "Max",
  "Grandma",
  // add everyone here
];
```

Redeploy after changes.

---

## Troubleshooting

**"Can't reach database"**
- Check `DATABASE_URL` is set correctly
- Neon DB may be sleeping — first request wakes it (takes ~1s)

**"Cloudinary upload failed"**
- Verify `CLOUDINARY_API_SECRET` is correct (server-side only)
- Check Cloudinary dashboard for error logs

**"Mic not working"**
- Browser requires HTTPS for `getUserMedia` — localhost works, but http:// won't
- On iOS Safari, mic access must be explicitly allowed in Settings

**Vercel build fails**
- Run `npx prisma generate` in build command: `prisma generate && next build`
- Set this in Vercel → Project Settings → Build Command
