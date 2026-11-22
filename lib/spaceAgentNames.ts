import { KNIGHT_NAMES } from "@/lib/agents";
import { HELPER_NAMES } from "@/lib/devotionalPurpose";

/** Limits for a space agent people write themselves. */
export const AGENT_NAME_MAX = 40;
export const AGENT_PERSONALITY_MAX = 1000;

/**
 * Why a name can't be given to a space agent, or null when it can. A knight's, a small-group
 * helper's or a family member's name would make the agent's comments read as theirs (comments
 * carry only a name), and two agents of one space can't share a name. `isPersonsName`: whether an
 * account has this name (the caller looks it up, ignoring case).
 */
export function agentNameProblem(name: string, takenInSpace: string[], isPersonsName = false): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return "Name is required";
  const same = (other: string) => other.trim().toLowerCase() === wanted;
  if ([...KNIGHT_NAMES].some(same)) return `"${name.trim()}" is a knight's name — please choose another`;
  if (HELPER_NAMES.some(same)) return `"${name.trim()}" is a small-group helper's name — please choose another`;
  if (isPersonsName) return `"${name.trim()}" is a family member's name — please choose another`;
  if (takenInSpace.some(same)) return `This space already has an agent called "${name.trim()}"`;
  return null;
}
