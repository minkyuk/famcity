import { agentNames } from "@/lib/agentNames";
import { KNIGHT_NAMES } from "@/lib/agents";
import { HEART_EMOJI, HEART_MEMORY_MS, type PersonHeart, type ThreadHeart } from "@/lib/hearts";
import { prisma } from "@/lib/prisma";

/**
 * Loading hearts for an agent's prompt (see lib/hearts.ts for what is shown and why). Nothing is
 * stored: hearts are read when an agent writes, so taking a heart back takes it out of memory.
 * Every query is bounded; a failure means no hearts in the prompt, never a failed turn.
 */

type ThreadComment = { id: string; userId: string | null; authorName: string; body: string };

/**
 * Post reactions carry only the display name they were given under (agents react too). A name
 * stands for a person only when it is no agent's and exactly one account has it — otherwise two
 * people's hearts could be told to agents as one person's.
 */
async function namesOfOnePerson(candidates: string[]): Promise<Set<string>> {
  const agents = await agentNames();
  const asked = [...new Set(candidates)].filter((name) => name && !agents.has(name) && !KNIGHT_NAMES.has(name));
  if (asked.length === 0) return new Set();
  const users = await prisma.user.findMany({ where: { name: { in: asked } }, select: { name: true } });
  const count = new Map<string, number>();
  for (const u of users) if (u.name) count.set(u.name, (count.get(u.name) ?? 0) + 1);
  return new Set(asked.filter((name) => count.get(name) === 1));
}

/** A members-only space is a scope of its own; system spaces and space-less posts are open. */
const scopeOf = (post: { spaceId: string | null; space: { isSystem: boolean } | null }) => (post.spaceId && !post.space?.isSystem ? post.spaceId : null);

/** People's hearts in one thread: on its AI comments, and ❤️ on the post. */
export async function threadHearts(postId: string, comments: ThreadComment[]): Promise<ThreadHeart[]> {
  const aiComments = comments.filter((c) => c.userId == null);
  const [likes, reactions] = await Promise.all([
    aiComments.length > 0
      ? prisma.commentLike.findMany({
          where: { commentId: { in: aiComments.map((c) => c.id) } },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { commentId: true, user: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.reaction.findMany({ where: { postId, emoji: HEART_EMOJI }, orderBy: { createdAt: "desc" }, take: 20, select: { name: true } }),
  ]);

  const people = await namesOfOnePerson(reactions.map((r) => r.name));

  const byId = new Map(aiComments.map((c) => [c.id, c]));
  const out: ThreadHeart[] = [];
  for (const like of likes) {
    const comment = byId.get(like.commentId);
    if (comment && like.user.name) out.push({ by: like.user.name, on: "comment", author: comment.authorName, snippet: comment.body });
  }
  for (const r of reactions) if (people.has(r.name)) out.push({ by: r.name, on: "post", author: "", snippet: "" });
  return out;
}

/**
 * What one person hearted lately among agents' replies and posts, usable in a thread of `scope`:
 * a heart given in a members-only space counts only in that space. `"everywhere"` is for the
 * person's own profile card only — never for a prompt. Nothing from before `since` (their memory
 * reset) is read.
 */
export async function personHearts(userId: string, name: string, scope: string | null | "everywhere", since: Date | null): Promise<PersonHeart[]> {
  const floor = new Date(Math.max(Date.now() - HEART_MEMORY_MS, since?.getTime() ?? 0));
  const postSelect = { userId: true, authorName: true, content: true, spaceId: true, space: { select: { isSystem: true } } } as const;
  const [likes, reactions, agents, nameIsTheirs] = await Promise.all([
    prisma.commentLike.findMany({
      where: { userId, createdAt: { gte: floor }, comment: { userId: null, post: { isPrivate: false } } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { createdAt: true, comment: { select: { authorName: true, post: { select: postSelect } } } },
    }),
    name // post reactions are found by display name — used only when that name is theirs alone (below)
      ? prisma.reaction.findMany({
          where: { name, emoji: HEART_EMOJI, createdAt: { gte: floor }, post: { userId: null, isPrivate: false } },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { createdAt: true, post: { select: postSelect } },
        })
      : Promise.resolve([]),
    agentNames(),
    namesOfOnePerson([name]).then((names) => names.has(name)),
  ]);

  const usable = (post: { spaceId: string | null; space: { isSystem: boolean } | null }) => {
    if (scope === "everywhere") return true;
    const s = scopeOf(post);
    return s === null || s === scope;
  };
  // The post's words may be shown only when it is the person's own or an agent's.
  const topicOf = (post: { userId: string | null; authorName: string; content: string | null }) =>
    post.userId === userId || (post.userId === null && agents.has(post.authorName)) ? post.content?.trim() || null : null;

  const out: PersonHeart[] = [];
  for (const like of likes) {
    const { comment } = like;
    if (!agents.has(comment.authorName) || !usable(comment.post)) continue; // an account-less comment by a person, or another space
    out.push({ agent: comment.authorName, topic: topicOf(comment.post), at: like.createdAt });
  }
  for (const r of nameIsTheirs ? reactions : []) {
    if (!agents.has(r.post.authorName) || !usable(r.post)) continue;
    out.push({ agent: r.post.authorName, topic: topicOf(r.post), at: r.createdAt });
  }
  return out;
}
