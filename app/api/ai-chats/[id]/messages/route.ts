import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const AppendSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
  })).min(1),
  model: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.aiConversation.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!conversation || conversation.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = AppendSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const { messages, model } = parsed.data;

  await prisma.$transaction([
    ...messages.map((m, i) =>
      prisma.aiConversationMessage.create({
        data: { conversationId: id, role: m.role, content: m.content, createdAt: new Date(Date.now() + i) },
      })
    ),
    prisma.aiConversation.update({
      where: { id },
      data: { updatedAt: new Date(), ...(model ? { model } : {}) },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
