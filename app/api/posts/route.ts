import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreatePostSchema } from "@/lib/validators";
import { sendPushToAll } from "@/lib/push";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const cursor = req.nextUrl.searchParams.get("cursor");

  const posts = await prisma.post.findMany({
    take: PAGE_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      reactions: true,
      comments: { orderBy: { createdAt: "asc" } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  const nextCursor =
    posts.length === PAGE_SIZE ? posts[posts.length - 1].id : null;

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
    return NextResponse.json(
      { error: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const post = await prisma.post.create({
    data: {
      ...result.data,
      authorName: session.user.name ?? "Family Member",
      authorImage: session.user.image ?? null,
      userId: session.user.id,
    },
    include: {
      reactions: true,
      comments: true,
      _count: { select: { reactions: true, comments: true } },
    },
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
