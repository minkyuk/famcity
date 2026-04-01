import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODELS = {
  "claude-haiku-4-5-20251001": { label: "Haiku", cost: 1 },
  "claude-sonnet-4-6": { label: "Sonnet", cost: 2 },
  "claude-opus-4-6": { label: "Opus", cost: 5 },
} as const;

type ModelId = keyof typeof MODELS;

const BodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(20000),
    })
  ).min(1).max(100),
  model: z.enum(["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]).default("claude-sonnet-4-6"),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { messages, model } = parsed.data;
  const cost = MODELS[model as ModelId].cost;
  const admin = isAdmin(session);

  // Deduct credits (admins bypass)
  if (!admin) {
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: session.user.id }, select: { credits: true } });
        if (!user || user.credits < cost) throw new Error("insufficient_credits");
        await tx.user.update({ where: { id: session.user.id }, data: { credits: { decrement: cost } } });
        await tx.creditTransaction.create({
          data: { userId: session.user.id, amount: -cost, reason: `analyze_${model}` },
        });
      });
    } catch (e) {
      if ((e as Error).message === "insufficient_credits") {
        return NextResponse.json({ error: `Not enough credits (need ${cost})` }, { status: 402 });
      }
      throw e;
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await anthropic.messages.stream({
          model,
          max_tokens: 4096,
          system: "You are a helpful, thoughtful assistant. Be direct and concise. Use plain prose — no unnecessary markdown unless it genuinely helps readability (e.g. code blocks for code). Do not pad your answers.",
          messages,
        });

        for await (const chunk of response) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(new TextEncoder().encode(`\n\n[Error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Accel-Buffering": "no",
    },
  });
}
