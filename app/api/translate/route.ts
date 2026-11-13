import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AGENT_REQUEST, anthropicFor, textOf } from "@/lib/anthropic";
import { z } from "zod";

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

  const response = await anthropicFor("translate:translate").messages.create({
    ...AGENT_REQUEST,
    max_tokens: 1300,
    messages: [{
      role: "user",
      content: `Translate the following text to ${targetLang}. Return only the translation, nothing else.\n\n${text}`,
    }],
  });

  const translated = textOf(response).trim();
  return NextResponse.json({ translated });
}
