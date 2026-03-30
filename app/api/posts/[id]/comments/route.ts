import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessiblePost } from "@/lib/postAccess";
import { z } from "zod";

const BodySchema = z.object({ body: z.string().min(1).max(1000) });

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
  const result = BodySchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: {
      postId,
      body: result.data.body,
      authorName: session.user.name ?? "Family Member",
      authorImage: session.user.image ?? null,
      userId: session.user.id,
    },
  });

  return NextResponse.json(comment, { status: 201 });
}
