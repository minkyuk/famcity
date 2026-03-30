import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreatePostSchema } from "@/lib/validators";
import { sendPushToAll } from "@/lib/push";
import { extractHashtags } from "@/lib/hashtags";

const PAGE_SIZE = 20;

const POST_INCLUDE = {
  reactions: true,
  comments: { orderBy: { createdAt: "asc" as const } },
  media: { orderBy: { order: "asc" as const } },
  hashtags: { include: { hashtag: true } },
  _count: { select: { reactions: true, comments: true } },
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor");
  const spaceId = req.nextUrl.searchParams.get("spaceId");
  const hashtag = req.nextUrl.searchParams.get("hashtag");

  // Space filter
  let spaceFilter = {};
  if (spaceId) {
    const membership = await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: session.user.id, spaceId } },
    });
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });
    spaceFilter = { spaceId };
  } else {
    const memberships = await prisma.spaceMember.findMany({
      where: { userId: session.user.id },
      select: { spaceId: true },
    });
    const spaceIds = memberships.map((m) => m.spaceId);
    // Show global posts (spaceId = null) + posts from user's spaces
    spaceFilter = { OR: [{ spaceId: null }, { spaceId: { in: spaceIds } }] };
  }

  // Hashtag filter
  let hashtagFilter = {};
  if (hashtag) {
    hashtagFilter = {
      hashtags: { some: { hashtag: { tag: hashtag.toLowerCase() } } },
    };
  }

  const posts = await prisma.post.findMany({
    take: PAGE_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    where: { ...spaceFilter, ...hashtagFilter },
    orderBy: { createdAt: "desc" },
    include: POST_INCLUDE,
  });

  const nextCursor = posts.length === PAGE_SIZE ? posts[posts.length - 1].id : null;
  return NextResponse.json({ posts, nextCursor });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const result = CreatePostSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.flatten().fieldErrors }, { status: 400 });
  }

  const { mediaUrls, ...postData } = result.data;

  if (postData.spaceId) {
    const membership = await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: session.user.id, spaceId: postData.spaceId } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this space" }, { status: 403 });
    }
  }

  // Extract hashtags from content
  const tags = postData.content ? extractHashtags(postData.content) : [];

  // Upsert hashtags and get their IDs
  const hashtagRecords = await Promise.all(
    tags.map((tag) =>
      prisma.hashtag.upsert({
        where: { tag },
        create: { tag },
        update: {},
      })
    )
  );

  const post = await prisma.post.create({
    data: {
      ...postData,
      authorName: session.user.name ?? "Family Member",
      authorImage: session.user.image ?? null,
      userId: session.user.id,
      media: mediaUrls?.length
        ? { create: mediaUrls.map((url, order) => ({ url, order })) }
        : undefined,
      hashtags: hashtagRecords.length
        ? { create: hashtagRecords.map((h) => ({ hashtagId: h.id })) }
        : undefined,
    },
    include: POST_INCLUDE,
  });

  const typeLabel: Record<string, string> = {
    TEXT: "shared a message",
    IMAGE: "shared a photo",
    YOUTUBE: "shared a video",
    AUDIO: "shared a voice message",
  };

  sendPushToAll({
    title: `${post.authorName} ${typeLabel[post.type] ?? "posted"}`,
    body: post.content ?? "Tap to see the post",
    url: `/posts/${post.id}`,
  }).catch(() => {});

  return NextResponse.json(post, { status: 201 });
}
