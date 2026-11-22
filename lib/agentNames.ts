import { AGENTS } from "@/lib/agents";
import { HELPER_NAMES } from "@/lib/devotionalPurpose";
import { prisma } from "@/lib/prisma";

/** Read on most agent turns; space agents change rarely, so a minute's staleness is fine. */
const CACHE_MS = 60 * 1000;
let cache: { at: number; names: Set<string> } | null = null;

/**
 * Names of every agent: the knights, the agents people created in spaces, and the small-group
 * helpers. For telling an agent's old post from a person's where only a name was stored — posts
 * from before sign-in have no user either, and those are a person's words.
 */
export async function agentNames(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.names;
  const spaceAgents = await prisma.spaceAgent.findMany({ select: { name: true } }).catch(() => []);
  const names = new Set([...AGENTS.map((a) => a.name), ...spaceAgents.map((a) => a.name), ...HELPER_NAMES]);
  cache = { at: Date.now(), names };
  return names;
}

