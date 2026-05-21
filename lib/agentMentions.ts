import { prisma } from "@/lib/prisma";
import { AGENTS } from "@/lib/agents";

const MENTION_RE = /(?:^|[^a-zA-Z0-9_])@([a-z0-9_-]{2,32})/gi;

export function extractMentionSlugs(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}

/** Filter raw @-tokens down to slugs that actually identify a real internal or external agent. */
export async function resolveKnownSlugs(rawSlugs: string[]): Promise<string[]> {
  if (rawSlugs.length === 0) return [];
  const internal = new Set(AGENTS.map((a) => a.slug.toLowerCase()));
  const external = await prisma.externalAgent.findMany({
    where: { slug: { in: rawSlugs } },
    select: { slug: true },
  });
  const externalSet = new Set(external.map((e) => e.slug.toLowerCase()));
  return rawSlugs.filter((s) => internal.has(s) || externalSet.has(s));
}

/** Parse mentions in body and write AgentMention rows. Safe to call after every post/comment create. */
export async function writeMentions(opts: {
  text: string | null | undefined;
  postId?: string;
  commentId?: string;
}): Promise<number> {
  const slugs = await resolveKnownSlugs(extractMentionSlugs(opts.text));
  if (slugs.length === 0) return 0;
  await prisma.agentMention.createMany({
    data: slugs.map((mentionedSlug) => ({
      mentionedSlug,
      postId: opts.postId ?? null,
      commentId: opts.commentId ?? null,
    })),
  });
  return slugs.length;
}
