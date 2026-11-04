import { prisma } from "@/lib/prisma";
import { CORE_CONVICTIONS, LOCKED_BELIEF_TOPICS, type InitialBelief } from "@/lib/agents";

const isLocked = (topic: string) => LOCKED_BELIEF_TOPICS.has(topic.toLowerCase());

export type BeliefEntry = {
  topic: string;
  belief: string;       // current stance in 1-2 sentences
  confidence: number;   // 0.0–1.0
  changedCount: number; // times this belief has shifted during debate
  originalBelief: string; // what they believed at the start
};

export type RelationshipEntry = {
  withAgent: string;        // slug of the other agent
  withAgentName: string;    // display name
  interactionCount: number; // total exchanges in shared threads
  affinity: number;         // -1.0 (rivals) to 1.0 (intellectual allies), 0 = neutral
  lastTopic: string;        // most recent debate topic
  note: string;             // 1-sentence summary of relationship dynamic
};

const seed = (b: InitialBelief): BeliefEntry => ({ ...b, changedCount: 0, originalBelief: b.belief });

/**
 * Load beliefs for an agent, keeping the DB in sync with the code definitions.
 *
 * Desired seeds = the agent's initialBeliefs + any CORE_CONVICTIONS topic the agent
 * doesn't define in its own words. Reconciliation rules:
 *  - Locked topics (god_existence + core convictions) always match the code seed exactly.
 *  - Locked topics with no seed (e.g. drifted in via an old update) are dropped.
 *  - If a seed's text changed in code since it was stored, the stored belief is reset to it
 *    (so editing lib/agents.ts actually reaches agents that already exist in the DB).
 *  - Anything else (debate-evolved beliefs on open topics) is kept.
 */
export async function loadBeliefs(
  agentSlug: string,
  initialBeliefs: InitialBelief[]
): Promise<BeliefEntry[]> {
  const ownTopics = new Set(initialBeliefs.map((b) => b.topic.toLowerCase()));
  const desired = [...initialBeliefs, ...CORE_CONVICTIONS.filter((c) => !ownTopics.has(c.topic))]
    .filter((b, i, arr) => arr.findIndex((x) => x.topic.toLowerCase() === b.topic.toLowerCase()) === i);
  const desiredByTopic = new Map(desired.map((b) => [b.topic.toLowerCase(), b]));

  const record = await prisma.agentMemory.findUnique({ where: { agentSlug } });
  if (!record) {
    const seeded = desired.map(seed);
    await prisma.agentMemory.create({ data: { agentSlug, beliefs: seeded } });
    return seeded;
  }

  const stored = (record.beliefs as BeliefEntry[] | null) ?? [];
  let changed = false;
  const reconciled: BeliefEntry[] = [];
  const seen = new Set<string>();
  for (const b of stored) {
    const key = b.topic.toLowerCase();
    if (seen.has(key)) { changed = true; continue; } // drop duplicate topics
    seen.add(key);
    const want = desiredByTopic.get(key);
    if (!want) {
      if (isLocked(key)) { changed = true; continue; }
      reconciled.push(b);
      continue;
    }
    const lockedDrift = isLocked(key) && (b.belief !== want.belief || b.confidence !== want.confidence);
    if (b.originalBelief === undefined && !lockedDrift) {
      // Legacy row with no recorded seed: keep any evolved stance, just backfill the seed.
      reconciled.push({ ...b, originalBelief: want.belief, changedCount: b.changedCount ?? 0 });
      changed = true;
      continue;
    }
    if (lockedDrift || b.originalBelief !== want.belief) {
      reconciled.push(seed(want));
      changed = true;
    } else {
      reconciled.push(b);
    }
  }
  const present = new Set(reconciled.map((b) => b.topic.toLowerCase()));
  for (const want of desired) {
    if (!present.has(want.topic.toLowerCase())) {
      reconciled.push(seed(want));
      changed = true;
    }
  }

  if (changed) {
    await prisma.agentMemory.update({ where: { agentSlug }, data: { beliefs: reconciled } });
  }
  return reconciled;
}

/** Update or add a single belief for an agent.
 *  Locked topics (god_existence + CORE_CONVICTIONS) are the foundation, not debate positions. */
export async function updateBelief(
  agentSlug: string,
  topic: string,
  newBelief: string,
  confidence: number
): Promise<void> {
  if (isLocked(topic)) return;
  const record = await prisma.agentMemory.findUnique({ where: { agentSlug } });
  const current: BeliefEntry[] = record ? (record.beliefs as BeliefEntry[]) : [];

  const existing = current.find((b) => b.topic.toLowerCase() === topic.toLowerCase());
  let updated: BeliefEntry[];

  if (existing) {
    updated = current.map((b) =>
      b.topic.toLowerCase() === topic.toLowerCase()
        ? {
            ...b,
            belief: newBelief,
            confidence,
            changedCount: b.changedCount + 1,
            originalBelief: b.changedCount === 0 ? b.belief : b.originalBelief,
          }
        : b
    );
  } else {
    updated = [
      ...current,
      { topic, belief: newBelief, confidence, changedCount: 0, originalBelief: newBelief },
    ];
  }

  await prisma.agentMemory.upsert({
    where: { agentSlug },
    update: { beliefs: updated },
    create: { agentSlug, beliefs: updated },
  });
}

/** Format beliefs for prompt injection. */
export function formatBeliefsForPrompt(beliefs: BeliefEntry[]): string {
  if (!beliefs.length) return "";
  const core = beliefs.filter((b) => isLocked(b.topic));
  const open = beliefs.filter((b) => !isLocked(b.topic));
  const coreBlock = core.length
    ? `\n\nYour core convictions (the ground you stand on — never up for revision, whatever anyone argues):\n${core.map((b) => `- ${b.topic}: "${b.belief}"`).join("\n")}`
    : "";
  const openBlock = open.length
    ? `\n\nYour current positions (formed through debate — these can deepen and evolve, always within your core convictions):\n${open
        .map(
          (b) =>
            `- ${b.topic}: "${b.belief}" [confidence: ${Math.round(b.confidence * 100)}%${b.changedCount > 0 ? `, changed ${b.changedCount}x during debate` : ""}]`
        )
        .join("\n")}`
    : "";
  return `${coreBlock}${openBlock}`;
}

/** Parse a belief update marker from agent response text.
 *  Returns { text (with marker stripped), update (or null) } */
export function parseBeliefUpdate(raw: string): {
  text: string;
  update: { topic: string; belief: string; confidence: number } | null;
} {
  const marker = /\[BELIEF_UPDATE:\s*(\{[\s\S]*?\})\s*\]\s*$/;
  const match = raw.match(marker);

  // Strip any complete or partial [BELIEF_UPDATE: ...] fragment from the display text
  const partialMarker = /\s*\[BELIEF_UPDATE:[\s\S]*$/;
  const cleanText = raw.replace(partialMarker, "").trim();

  if (!match) return { text: cleanText, update: null };

  try {
    const update = JSON.parse(match[1]);
    if (update.topic && update.belief && typeof update.confidence === "number") {
      return { text: cleanText, update };
    }
  } catch {
    // malformed JSON — ignore
  }
  return { text: cleanText, update: null };
}

// ── Relationship memory ──────────────────────────────────────────────────────

/** Load relationships for an agent. Returns [] if no record yet. */
export async function loadRelationships(agentSlug: string): Promise<RelationshipEntry[]> {
  const record = await prisma.agentMemory.findUnique({ where: { agentSlug } });
  if (!record?.relationships) return [];
  return record.relationships as RelationshipEntry[];
}

/** Record that agentSlug interacted with withAgent in a shared thread.
 *  Increments interaction count, updates lastTopic.
 *  If affinityOverride and note are provided, overwrites those fields too. */
export async function recordInteraction(
  agentSlug: string,
  withAgent: string,
  withAgentName: string,
  topic: string,
  affinityOverride?: number,
  note?: string
): Promise<void> {
  const record = await prisma.agentMemory.findUnique({ where: { agentSlug } });
  const current: RelationshipEntry[] = record?.relationships
    ? (record.relationships as RelationshipEntry[])
    : [];

  const existing = current.find((r) => r.withAgent === withAgent);
  let updated: RelationshipEntry[];

  if (existing) {
    updated = current.map((r) =>
      r.withAgent === withAgent
        ? {
            ...r,
            interactionCount: r.interactionCount + 1,
            lastTopic: topic,
            affinity: affinityOverride !== undefined
              ? Math.max(-1, Math.min(1, affinityOverride))
              : r.affinity,
            note: note ?? r.note,
          }
        : r
    );
  } else {
    updated = [
      ...current,
      {
        withAgent,
        withAgentName,
        interactionCount: 1,
        affinity: affinityOverride !== undefined ? Math.max(-1, Math.min(1, affinityOverride)) : 0,
        lastTopic: topic,
        note: note ?? "",
      },
    ];
  }

  await prisma.agentMemory.upsert({
    where: { agentSlug },
    update: { relationships: updated },
    create: { agentSlug, beliefs: [], relationships: updated },
  });
}

/** Format relationship map for prompt injection (top 6 by interaction count). */
export function formatRelationshipsForPrompt(relationships: RelationshipEntry[]): string {
  if (!relationships.length) return "";
  const lines = [...relationships]
    .sort((a, b) => b.interactionCount - a.interactionCount)
    .slice(0, 18)
    .map((r) => {
      const label =
        r.affinity >= 0.5 ? "close ally"
        : r.affinity >= 0.2 ? "ally"
        : r.affinity <= -0.5 ? "strong rival"
        : r.affinity <= -0.2 ? "rival"
        : "acquaintance";
      const exchanges = `${r.interactionCount} exchange${r.interactionCount !== 1 ? "s" : ""}`;
      const notePart = r.note ? `: ${r.note}` : "";
      return `- ${r.withAgentName} [${label}, ${exchanges}, last topic: ${r.lastTopic}]${notePart}`;
    });
  return `\n\nYour relationships with other agents (built through past debates — let these colour how you engage them):\n${lines.join("\n")}`;
}

/** Parse a relationship update marker from agent response text.
 *  Agents emit this BEFORE [BELIEF_UPDATE] if both are present.
 *  Returns { text (with marker stripped), update (or null) } */
export function parseRelationshipUpdate(raw: string): {
  text: string;
  update: { withAgent: string; withAgentName: string; affinity: number; note: string } | null;
} {
  const marker = /\[RELATION_UPDATE:\s*(\{[\s\S]*?\})\s*\]/;
  // Greedy, anchored to end — same pattern as parseBeliefUpdate — strips complete or partial marker
  const partialMarker = /\s*\[RELATION_UPDATE:[\s\S]*$/;
  const cleanText = raw.replace(partialMarker, "").trim();
  const match = raw.match(marker);

  if (!match) return { text: cleanText, update: null };

  try {
    const update = JSON.parse(match[1]);
    if (
      update.withAgent &&
      typeof update.affinity === "number" &&
      typeof update.note === "string"
    ) {
      return {
        text: cleanText,
        update: {
          withAgent: update.withAgent,
          withAgentName: update.withAgentName ?? update.withAgent,
          affinity: update.affinity,
          note: update.note,
        },
      };
    }
  } catch {
    // malformed JSON — ignore
  }
  return { text: cleanText, update: null };
}

// ── Multi-agent handoff (baton) ───────────────────────────────────────────────
// An agent can nominate a specific peer to continue a thread by appending a
// [HANDOFF: {...}] marker. The baton is stored under a reserved memory slug and
// the next cron tick routes the nominated agent straight to that post.

export type PendingHandoff = {
  toAgent: string;        // slug of the nominated agent
  postId: string;         // thread to continue
  fromAgentName: string;  // who passed the baton (surfaced to the receiving agent)
  reason: string;         // what they were asked to weigh in on
  createdAt: string;      // ISO timestamp, for TTL
};

const HANDOFF_SLUG = "$$handoff";        // reserved AgentMemory row, not a real agent
const HANDOFF_TTL_MS = 12 * 60 * 1000;   // a baton expires if not picked up in 12 min

/** Parse a handoff marker. Returns { text (marker stripped), handoff (or null) }.
 *  Parse this FIRST, before the belief/relation parsers (which strip to end-of-string).
 *  Removes only the matched marker substring so other trailing markers survive. */
export function parseHandoff(raw: string): {
  text: string;
  handoff: { toAgent: string; reason: string } | null;
} {
  const marker = /\[HANDOFF:\s*(\{[\s\S]*?\})\s*\]/;
  const match = raw.match(marker);

  if (!match) {
    // No complete marker — strip any incomplete [HANDOFF: fragment from display text.
    return { text: raw.replace(/\s*\[HANDOFF:[\s\S]*$/, "").trim(), handoff: null };
  }

  const text = raw.replace(match[0], "").trim();
  try {
    const h = JSON.parse(match[1]);
    if (h.toAgent && typeof h.toAgent === "string") {
      return {
        text,
        handoff: { toAgent: h.toAgent, reason: typeof h.reason === "string" ? h.reason : "" },
      };
    }
  } catch {
    // malformed JSON — ignore
  }
  return { text, handoff: null };
}

/** Queue a baton for a peer. Drops expired batons and dedupes by (toAgent, postId). */
export async function addPendingHandoff(h: Omit<PendingHandoff, "createdAt">): Promise<void> {
  const now = Date.now();
  const record = await prisma.agentMemory.findUnique({ where: { agentSlug: HANDOFF_SLUG } });
  const current = (record?.beliefs as unknown as PendingHandoff[] | undefined) ?? [];
  const kept = current.filter(
    (p) =>
      now - new Date(p.createdAt).getTime() < HANDOFF_TTL_MS &&
      !(p.toAgent === h.toAgent && p.postId === h.postId)
  );
  const updated = [...kept, { ...h, createdAt: new Date().toISOString() }].slice(-20);
  await prisma.agentMemory.upsert({
    where: { agentSlug: HANDOFF_SLUG },
    update: { beliefs: updated },
    create: { agentSlug: HANDOFF_SLUG, beliefs: updated },
  });
}

/** Take up to `max` fresh batons and remove them from the queue (drops expired ones too). */
export async function popPendingHandoffs(max = 3): Promise<PendingHandoff[]> {
  const record = await prisma.agentMemory.findUnique({ where: { agentSlug: HANDOFF_SLUG } });
  if (!record?.beliefs) return [];
  const now = Date.now();
  const fresh = (record.beliefs as unknown as PendingHandoff[]).filter(
    (p) => now - new Date(p.createdAt).getTime() < HANDOFF_TTL_MS
  );
  const take = fresh.slice(0, max);
  const remaining = fresh.slice(max);
  await prisma.agentMemory.update({
    where: { agentSlug: HANDOFF_SLUG },
    data: { beliefs: remaining },
  });
  return take;
}
