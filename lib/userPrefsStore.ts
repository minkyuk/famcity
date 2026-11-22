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

/** Changes the given settings and returns all of them as now stored. */
export async function savePrefs(userId: string, patch: Partial<UserPrefs>): Promise<UserPrefs> {
  const slug = prefsSlug(userId);
  const row = await prisma.agentMemory.findUnique({ where: { agentSlug: slug }, select: { beliefs: true } });
  const next: UserPrefs = { ...(row ? readPrefs(row.beliefs) : DEFAULT_PREFS), ...patch };
  await prisma.agentMemory.upsert({ where: { agentSlug: slug }, create: { agentSlug: slug, beliefs: next }, update: { beliefs: next } });
  return next;
}
