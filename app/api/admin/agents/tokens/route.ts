import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { AGENTS } from "@/lib/agents";
import { generateToken } from "@/lib/agentAuth";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) return null;
  return session;
}

/** GET — list all tokens (no plaintext, just metadata). */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tokens = await prisma.agentApiToken.findMany({
    orderBy: { createdAt: "desc" },
    include: { externalAgent: true },
  });
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      kind: t.internalSlug ? "internal" : "external",
      slug: t.internalSlug ?? t.externalAgent?.slug,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      revokedAt: t.revokedAt,
    })),
  });
}

const ExternalAgentInput = z.object({
  slug: z.string().regex(/^[a-z0-9_-]{2,32}$/, "lowercase alnum, _ or -, 2-32 chars"),
  name: z.string().min(1).max(64),
  avatar: z.string().url().optional(),
  description: z.string().max(500).optional(),
  projectName: z.string().max(64).optional(),
});

const Body = z.object({
  name: z.string().min(1).max(64),
  internalSlug: z.string().optional(),
  externalAgent: ExternalAgentInput.optional(),
}).refine(
  (v) => Boolean(v.internalSlug) !== Boolean(v.externalAgent),
  { message: "Provide exactly one of internalSlug or externalAgent" }
);

/** POST — issue a new token. Returns plaintext exactly once. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let internalSlug: string | null = null;
  let externalAgentId: string | null = null;

  if (parsed.data.internalSlug) {
    const known = AGENTS.find((a) => a.slug === parsed.data.internalSlug);
    if (!known) return NextResponse.json({ error: "Unknown internal slug" }, { status: 400 });
    internalSlug = known.slug;
  } else if (parsed.data.externalAgent) {
    const ext = parsed.data.externalAgent;
    // Reject collision with an internal slug — keeps the @mention namespace unambiguous
    if (AGENTS.find((a) => a.slug === ext.slug)) {
      return NextResponse.json({ error: "Slug collides with an internal agent" }, { status: 409 });
    }
    const upserted = await prisma.externalAgent.upsert({
      where: { slug: ext.slug },
      create: ext,
      update: {
        name: ext.name,
        avatar: ext.avatar ?? null,
        description: ext.description ?? null,
        projectName: ext.projectName ?? null,
      },
    });
    externalAgentId = upserted.id;
  }

  const { plaintext, prefix, hash } = generateToken();
  const row = await prisma.agentApiToken.create({
    data: {
      name: parsed.data.name,
      internalSlug,
      externalAgentId,
      prefix,
      hashedToken: hash,
    },
  });

  return NextResponse.json(
    {
      id: row.id,
      prefix,
      token: plaintext,
      warning: "Save this token now — it will not be shown again.",
    },
    { status: 201 }
  );
}
