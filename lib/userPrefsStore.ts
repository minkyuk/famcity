import { prisma } from "@/lib/prisma";
import { DEFAULT_PREFS, prefsSlug, readPrefs, type UserPrefs } from "@/lib/userPrefs";

/**
 * Where settings live: one AgentMemory row per person under the reserved slug `$$prefs:<userId>`
 * (JSON in `beliefs`), the same pattern as `$$sketch:` — no schema change. Code that lists agent
 * rows always asks for specific slugs, so these rows never show up as agents.
 */

/** A person's settings. A storage error means the defaults — settings never break a page. */
export async function loadPrefs(userId: string): Promise<UserPrefs> {
  try {
    const row = await prisma.agentMemory.findUnique({ where: { agentSlug: prefsSlug(userId) }, select: { beliefs: true } });
    return row ? readPrefs(row.beliefs) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * Changes the given settings and returns all of them as now stored. The write only lands if the
 * row is still the one that was read (or still absent), and is retried otherwise — so two changes
 * saved at the same moment (the cat & dog, then the music button) can't undo one another.
 */
export async function savePrefs(userId: string, patch: Partial<UserPrefs>): Promise<UserPrefs> {
  const slug = prefsSlug(userId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await prisma.agentMemory.findUnique({ where: { agentSlug: slug }, select: { beliefs: true, updatedAt: true } });
    const next: UserPrefs = { ...(row ? readPrefs(row.beliefs) : DEFAULT_PREFS), ...patch };
    const written = row
      ? (await prisma.agentMemory.updateMany({ where: { agentSlug: slug, updatedAt: row.updatedAt }, data: { beliefs: next } })).count === 1
      : await prisma.agentMemory.create({ data: { agentSlug: slug, beliefs: next } }).then(() => true, () => false); // false: the row appeared meanwhile
    if (written) return next;
  }
  throw new Error("settings kept changing while saving");
}
