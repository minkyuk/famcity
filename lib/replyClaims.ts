/**
 * One claim row per message an agent owes a reply to (pure rules; the rows live in AgentMemory
 * under a reserved slug such as `$$reply:<commentId>` or `$$devo:<postId>:<commentId|post>`).
 * The row makes sure a message is answered by one run only, and remembers how it went:
 *   working  — an agent is writing; another run may take over only after `workingMs`
 *   dropped  — no reply came of it; tried again after `retryMs`, and given up once `maxTries`
 *              drafts have failed a gate (outages don't count as tries)
 *   declined — the message was judged not to need an agent; never asked again
 *   done     — answered; never again, even if someone deletes the reply
 */

/**
 * How one turn on a message ended: answered; judged not to need a reply; a draft that didn't pass
 * a gate; or no draft at all (an outage, or the message was gone by then).
 */
export type ClaimOutcome = "done" | "declined" | "dropped" | "failed";
export type Claim = { state: string; tries: number; updatedAt: Date };
export type ClaimPolicy = { workingMs: number; retryMs: number; maxTries: number };

/** Reads a stored claim row; anything unreadable counts as a turn in progress (it frees itself in a few minutes). */
export function readClaim(row: { beliefs: unknown; updatedAt: Date }): Claim {
  const b = row.beliefs && typeof row.beliefs === "object" ? (row.beliefs as Record<string, unknown>) : {}; // our own row: { state, tries }
  return { state: typeof b.state === "string" ? b.state : "working", tries: typeof b.tries === "number" ? b.tries : 0, updatedAt: row.updatedAt };
}

/** May this message's turn be taken now? `claim` is its row as just read (undefined = no row yet). */
export function claimIsOpen(claim: Claim | undefined, now: number, policy: ClaimPolicy): boolean {
  if (!claim) return true;
  if (claim.state === "declined" || claim.state === "done" || claim.tries >= policy.maxTries) return false;
  return now - claim.updatedAt.getTime() > (claim.state === "dropped" ? policy.retryMs : policy.workingMs);
}

/** What to store when a turn ends, given the drafts that failed a gate so far (outages excluded). */
export function claimRow(outcome: ClaimOutcome, tries: number): { state: string; tries: number } {
  return { state: outcome === "failed" ? "dropped" : outcome, tries };
}
