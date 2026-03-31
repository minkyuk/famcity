import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const Schema = z.object({ text: z.string().min(1).max(2000) });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const result = Schema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const { text } = result.data;
  const isKorean = (text.match(/[\uAC00-\uD7A3]/g) ?? []).length / text.replace(/\s/g, "").length > 0.3;
  const targetLang = isKorean ? "English" : "Korean (한국어)";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `Translate the following text to ${targetLang}. Return only the translation, nothing else.\n\n${text}`,
    }],
  });

  const translated = response.content[0].type === "text" ? response.content[0].text.trim() : "";
  return NextResponse.json({ translated });
}
