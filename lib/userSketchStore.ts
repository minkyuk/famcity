import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emptySketch, readSketch, sketchBlock, sketchNote, sketchSlug, SKETCH_SLUG_PREFIX, type UserSketch } from "@/lib/userSketch";

/**
 * Where sketches live: one AgentMemory row per person under the reserved slug `$$sketch:<userId>`
 * (JSON in `beliefs`), the same pattern as `$$attempts:` and `$$heartbeat:` — no schema change.
 * Code that lists agent rows always asks for specific slugs, so these rows never show up as agents.
 */

/** People whose sketches an agent is shown in one thread. */
const MAX_PEOPLE_PER_THREAD = 3;

// The sketch is plain JSON (strings, numbers, null, arrays, objects); Prisma's JSON input type
// just can't see that through a named interface.
const asJson = (sketch: UserSketch) => sketch as unknown as Prisma.InputJsonObject;

export async function loadSketch(userId: string): Promise<UserSketch | null> {
  const row = await prisma.agentMemory.findUnique({ where: { agentSlug: sketchSlug(userId) }, select: { beliefs: true } });
  return row ? readSketch(row.beliefs) : null;
}

export async function loadSketches(userIds: string[]): Promise<Map<string, UserSketch>> {
  const out = new Map<string, UserSketch>();
  if (userIds.length === 0) return out;
  const rows = await prisma.agentMemory.findMany({
    where: { agentSlug: { in: userIds.map(sketchSlug) } },
    select: { agentSlug: true, beliefs: true },
  });
  for (const row of rows) {
    const sketch = readSketch(row.beliefs);
    if (sketch) out.set(row.agentSlug.slice(SKETCH_SLUG_PREFIX.length), sketch);
  }
  return out;
}

export async function saveSketch(userId: string, sketch: UserSketch): Promise<void> {
  const slug = sketchSlug(userId);
  await prisma.agentMemory.upsert({
    where: { agentSlug: slug },
    create: { agentSlug: slug, beliefs: asJson(sketch) },
    update: { beliefs: asJson(sketch) },
  });
}

/**
 * Clears what is remembered about a person. The row is kept, empty, with `resetAt` set: nothing
 * the person wrote before this moment is ever read into a sketch again.
 */
export async function resetSketch(userId: string, name: string): Promise<UserSketch> {
  const cleared = emptySketch(name, new Date().toISOString());
  await saveSketch(userId, cleared);
  return cleared;
}

type ThreadPeople = {
  userId: string | null;
  spaceId: string | null;
  comments: { userId: string | null }[];
};

/**
 * The memory block for an agent about to write in this thread: the person it is answering (the
 * last person to comment, or the post's author) and up to two others who spoke recently.
 * Items said in a members-only space are used only in threads of that space; a hardship is shown
 * only for the person being answered. Returns "" when nobody here has a sketch, or on any error —
 * memory is a help, never a reason for a turn to fail.
 */
export async function sketchContextFor(post: ThreadPeople): Promise<string> {
  try {
    const recentFirst = [...post.comments].reverse().flatMap((c) => (c.userId ? [c.userId] : []));
    const answering = recentFirst[0] ?? post.userId;
    if (!answering) return "";
    const people = [...new Set([answering, ...recentFirst, ...(post.userId ? [post.userId] : [])])].slice(0, MAX_PEOPLE_PER_THREAD);
    const sketches = await loadSketches(people);
    const now = Date.now();
    return sketchBlock(
      people.map((id) => {
        const sketch = sketches.get(id);
        return sketch ? sketchNote(sketch, { scope: post.spaceId, answering: id === answering, now }) : "";
      }),
    );
  } catch {
    return "";
  }
}
