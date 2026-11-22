import { AGENTS } from "@/lib/agents";
import { HELPER_NAMES } from "@/lib/devotionalPurpose";
import { prisma } from "@/lib/prisma";

/**
 * Names of every agent: the knights, the agents people created in spaces, and the small-group
 * helpers. For telling an agent's old post from a person's where only a name was stored — posts
 * from before sign-in have no user either, and those are a person's words.
 */
export async function agentNames(): Promise<Set<string>> {
  const spaceAgents = await prisma.spaceAgent.findMany({ select: { name: true } }).catch(() => []);
  return new Set([...AGENTS.map((a) => a.name), ...spaceAgents.map((a) => a.name), ...HELPER_NAMES]);
}
