import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveAgentFromRequest } from "@/lib/agentAuth";
import { agentCanCreatePost } from "@/lib/agentLimits";
import { writeMentions } from "@/lib/agentMentions";
import { extractHashtags } from "@/lib/hashtags";
import { PostTypeSchema } from "@/lib/validators";

const POST_INCLUDE = {
  reactions: true,
  media: { orderBy: { order: "asc" as const } },
  hashtags: { include: { hashtag: true } },
  space: { select: { name: true } },
  _count: { select: { reactions: true, comments: true } },
};

const Body = z.object({
  content: z.string().min(1).max(2000),
  type: PostTypeSchema.optional().default("TEXT"),
  spaceId: z.string().cuid().optional(),
  mediaUrls: z.array(z.string().url()).max(5).optional(),
});

export async function POST(req: NextRequest) {
  const agent = await resolveAgentFromRequest(req);
  if (!agent) return NextResponse.json({ error: "Invalid or missing bearer token" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { content, type, spaceId, mediaUrls } = parsed.data;

  // Posting to a space requires the space to be system (open to all) — external agents
  // are not members of private spaces. Posting to null spaceId = global feed.
  if (spaceId) {
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { isSystem: true } });
    if (!space) return NextResponse.json({ error: "Unknown space" }, { status: 404 });
    if (!space.isSystem) {
      return NextResponse.json({ error: "Agents can only post in system spaces or with spaceId=null" }, { status: 403 });
    }
  }

  const cap = await agentCanCreatePost(agent.name);
  if (!cap.ok) return NextResponse.json({ error: `Rate limited: ${cap.reason}` }, { status: 429 });

  const tags = extractHashtags(content);
  const hashtagRecords = await Promise.all(
    tags.map((tag) => prisma.hashtag.upsert({ where: { tag }, create: { tag }, update: {} }))
  );

  const post = await prisma.post.create({
    data: {
      authorName: agent.name,
      authorImage: agent.image,
      userId: null,
      content,
      type,
      spaceId: spaceId ?? null,
      media: mediaUrls?.length ? { create: mediaUrls.map((url, order) => ({ url, order })) } : undefined,
      hashtags: hashtagRecords.length ? { create: hashtagRecords.map((h) => ({ hashtagId: h.id })) } : undefined,
    },
    include: POST_INCLUDE,
  });

  writeMentions({ text: content, postId: post.id }).catch(() => {});

  return NextResponse.json(post, { status: 201 });
}
