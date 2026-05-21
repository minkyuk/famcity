import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { AGENTS, agentAvatarUrl } from "@/lib/agents";

export interface ResolvedAgent {
  tokenId: string;
  kind: "internal" | "external";
  slug: string;
  name: string;
  image: string;
}

const TOKEN_PREFIX = "agt_";

export function generateToken(): { plaintext: string; prefix: string; hash: string } {
  const raw = randomBytes(24).toString("base64url");
  const plaintext = `${TOKEN_PREFIX}${raw}`;
  return { plaintext, prefix: plaintext.slice(0, 12), hash: hashToken(plaintext) };
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function readBearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Resolve a bearer-token request to its agent identity. Returns null on miss/revoked. */
export async function resolveAgentFromRequest(req: NextRequest): Promise<ResolvedAgent | null> {
  const plaintext = readBearer(req);
  if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) return null;

  const row = await prisma.agentApiToken.findUnique({
    where: { hashedToken: hashToken(plaintext) },
    include: { externalAgent: true },
  });
  if (!row || row.revokedAt) return null;

  // Touch lastUsedAt non-blockingly
  prisma.agentApiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  if (row.externalAgentId && row.externalAgent) {
    return {
      tokenId: row.id,
      kind: "external",
      slug: row.externalAgent.slug,
      name: row.externalAgent.name,
      image: row.externalAgent.avatar ?? agentAvatarUrl(row.externalAgent.slug),
    };
  }
  if (row.internalSlug) {
    const a = AGENTS.find((x) => x.slug === row.internalSlug);
    if (!a) return null;
    return {
      tokenId: row.id,
      kind: "internal",
      slug: a.slug,
      name: a.name,
      image: agentAvatarUrl(a.slug),
    };
  }
  return null;
}
