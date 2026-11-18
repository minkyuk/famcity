import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emptySketch, readSketch, sketchBlock, sketchNote, sketchSlug, SKETCH_SLUG_PREFIX, type UserSketch } from "@/lib/userSketch";

/**
 * Where sketches live: one AgentMemory row per person under the reserved slug `$$sketch:<userId>`
 * (JSON in `beliefs`), the same pattern as `$$attempts:` and `$$heartbeat:` — no schema change.
 * Code that lists agent rows always asks for specific slugs, so these rows never show up as agents.
 */

/** People an agent is shown notes about in one thread: the person it is answering, then others who spoke. */
const MAX_PEOPLE_PER_THREAD = 3;

/** A stored sketch and the moment its row was last written — the version an update must still match. */
export type SketchRow = { sketch: UserSketch; updatedAt: Date };

// The sketch is plain JSON (strings, numbers, null, arrays, objects); Prisma's JSON input type
// just can't see that through a named interface.
const asJson = (sketch: UserSketch) => sketch as unknown as Prisma.InputJsonObject;

/**
 * A row that exists but can't be read is treated as cleared just now. The alternative — acting as
 * if the person had no sketch — would re-read everything they ever wrote, including what came
 * before a reset recorded in that damaged row.
 */
const readRow = (beliefs: unknown): UserSketch => readSketch(beliefs) ?? emptySketch("", new Date().toISOString());

export async function loadSketchRows(userIds: string[]): Promise<Map<string, SketchRow>> {
  const out = new Map<string, SketchRow>();
  if (userIds.length === 0) return out;
  const rows = await prisma.agentMemory.findMany({
    where: { agentSlug: { in: userIds.map(sketchSlug) } },
    select: { agentSlug: true, beliefs: true, updatedAt: true },
  });
  for (const row of rows) out.set(row.agentSlug.slice(SKETCH_SLUG_PREFIX.length), { sketch: readRow(row.beliefs), updatedAt: row.updatedAt });
  return out;
}

export async function loadSketch(userId: string): Promise<UserSketch | null> {
  return (await loadSketchRows([userId])).get(userId)?.sketch ?? null;
}

/** Writes unconditionally. Only the person's own reset does this — a reset always wins. */
export async function saveSketch(userId: string, sketch: UserSketch): Promise<void> {
  const slug = sketchSlug(userId);
  await prisma.agentMemory.upsert({
    where: { agentSlug: slug },
    create: { agentSlug: slug, beliefs: asJson(sketch) },
    update: { beliefs: asJson(sketch) },
  });
}

/**
 * Writes only if the row is still the one that was read (`expected` = its `updatedAt`, or null
 * when there was no row). Returns false when someone wrote in between — in practice the person
 * clearing their sketch while an update was being prepared, which must not be undone.
 */
export async function saveSketchIfUnchanged(userId: string, sketch: UserSketch, expected: Date | null): Promise<boolean> {
  const slug = sketchSlug(userId);
  if (expected === null) {
    try {
      await prisma.agentMemory.create({ data: { agentSlug: slug, beliefs: asJson(sketch) } });
      return true;
    } catch {
      return false; // the row appeared meanwhile
    }
  }
  const written = await prisma.agentMemory.updateMany({ where: { agentSlug: slug, updatedAt: expected }, data: { beliefs: asJson(sketch) } });
  return written.count === 1;
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
 * The memory block for an agent about to write in this thread: full notes on the person it is
 * answering (`answeringUserId` when the caller knows, else the last person to comment, or the
 * post's author), and character and ideas only for up to two others who spoke recently. Items said in a members-only space are used only in
 * threads of that space. Returns "" when nobody here has a sketch, or on any error — memory is a
 * help, never a reason for a turn to fail.
 */
export async function sketchContextFor(post: ThreadPeople, answeringUserId?: string | null): Promise<string> {
  try {
    const recentFirst = [...post.comments].reverse().flatMap((c) => (c.userId ? [c.userId] : []));
    const answering = answeringUserId ?? recentFirst[0] ?? post.userId;
    if (!answering) return "";
    const people = [...new Set([answering, ...recentFirst, ...(post.userId ? [post.userId] : [])])].slice(0, MAX_PEOPLE_PER_THREAD);
    const rows = await loadSketchRows(people);
    const now = Date.now();
    return sketchBlock(
      people.map((id) => {
        const row = rows.get(id);
        return row ? sketchNote(row.sketch, { scope: post.spaceId, answering: id === answering, now }) : "";
      }),
    );
  } catch {
    return "";
  }
}
