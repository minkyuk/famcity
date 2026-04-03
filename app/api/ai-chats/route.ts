import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversations = await prisma.aiConversation.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, model: true, updatedAt: true },
  });

  return NextResponse.json(conversations);
}

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
  })).min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const { title, model, messages } = parsed.data;

  const conversation = await prisma.aiConversation.create({
    data: {
      userId: session.user.id,
      title,
      model,
      messages: {
        create: messages.map((m, i) => ({
          role: m.role,
          content: m.content,
          createdAt: new Date(Date.now() + i),
        })),
      },
    },
    select: { id: true, title: true, model: true, updatedAt: true },
  });

  return NextResponse.json(conversation, { status: 201 });
}
