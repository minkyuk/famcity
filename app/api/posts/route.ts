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
  space: { select: { name: true } },
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

  // Space filter — must use AND so it doesn't collide with other OR clauses
  const andClauses: object[] = [];
  let firstSharedSpaceByUser: Map<string, string> | null = null;

  if (spaceId) {
    // System spaces are readable by anyone; regular spaces require membership
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { isSystem: true } });
    if (!space?.isSystem) {
      const membership = await prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId: session.user.id, spaceId } },
      });
      if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }
    andClauses.push({ spaceId });
  } else {
    // "All" feed: member spaces + always-visible system spaces + global posts from private-space co-members
    const [memberships, systemOpenSpaces, excludedSpaces] = await Promise.all([
      prisma.spaceMember.findMany({ where: { userId: session.user.id }, select: { spaceId: true } }),
      prisma.space.findMany({ where: { isSystem: true, excludeFromAll: false }, select: { id: true } }),
      prisma.space.findMany({ where: { excludeFromAll: true }, select: { id: true } }),
    ]);
    const excludedIds = new Set(excludedSpaces.map((s) => s.id));
    const systemOpenIdSet = new Set(systemOpenSpaces.map((s) => s.id));
    const memberSpaceIds = memberships.map((m) => m.spaceId).filter((id) => !excludedIds.has(id));

    // Feed includes member spaces + always-visible system spaces
    const spaceIds = [...new Set([...memberSpaceIds, ...systemOpenSpaces.map((s) => s.id)])];

    // Co-member label uses ONLY private (non-system) spaces so system spaces
    // shared by everyone don't inflate co-member lists
    const privateSpaceIds = memberSpaceIds.filter((id) => !systemOpenIdSet.has(id));

    firstSharedSpaceByUser = new Map<string, string>();
    if (privateSpaceIds.length > 0) {
      const [coMemberships, spaceNames] = await Promise.all([
        prisma.spaceMember.findMany({ where: { spaceId: { in: privateSpaceIds } }, select: { userId: true, spaceId: true } }),
        prisma.space.findMany({ where: { id: { in: privateSpaceIds } }, select: { id: true, name: true } }),
      ]);
      const spaceNameById = new Map(spaceNames.map((s) => [s.id, s.name]));
      for (const m of coMemberships) {
        if (!firstSharedSpaceByUser.has(m.userId)) {
          const n = spaceNameById.get(m.spaceId);
          if (n) firstSharedSpaceByUser.set(m.userId, n);
        }
      }
    }

    const coMemberIds = [...firstSharedSpaceByUser.keys()];

    andClauses.push({
      OR: [
        ...(spaceIds.length > 0 ? [{ spaceId: { in: spaceIds } }] : []),
        ...(coMemberIds.length > 0 ? [{ spaceId: null, userId: { in: coMemberIds } }] : []),
        { spaceId: null, userId: session.user.id },
        { spaceId: null, userId: null },
      ],
    });
  }

  // Privacy: show public posts + own private posts
  andClauses.push({ OR: [{ isPrivate: false }, { userId: session.user.id }] });

  // Hashtag filter
  if (hashtag) {
    andClauses.push({ hashtags: { some: { hashtag: { tag: hashtag.toLowerCase() } } } });
  }

  const posts = await prisma.post.findMany({
    take: PAGE_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    where: { AND: andClauses },
    orderBy: { createdAt: "desc" },
    include: POST_INCLUDE,
  });

  const nextCursor = posts.length === PAGE_SIZE ? posts[posts.length - 1].id : null;

  // Attach mutualSpace to global posts from co-members
  const postsWithMutual = posts.map((post) => ({
    ...post,
    mutualSpace:
      !post.spaceId && post.userId && post.userId !== session.user.id && firstSharedSpaceByUser
        ? (firstSharedSpaceByUser.get(post.userId) ?? null)
        : null,
  }));

  return NextResponse.json({ posts: postsWithMutual, nextCursor });
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
