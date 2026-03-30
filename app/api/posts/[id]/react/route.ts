import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessiblePost } from "@/lib/postAccess";
import { z } from "zod";

const Schema = z.object({ emoji: z.string().min(1).max(10) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: postId } = await params;
  const access = await getAccessiblePost(postId, session.user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const result = Schema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { emoji } = result.data;
  const name = session.user.name ?? "Family Member";

  const existing = await prisma.reaction.findUnique({
    where: { postId_emoji_name: { postId, emoji, name } },
  });

  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    return NextResponse.json({ toggled: "off" });
  }

  const reaction = await prisma.reaction.create({
    data: { postId, emoji, name },
  });

  return NextResponse.json({ toggled: "on", reaction }, { status: 201 });
}
