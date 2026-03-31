import { prisma } from "@/lib/prisma";

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

/** Load beliefs for an agent; seeds from initialBeliefs if no DB record exists yet. */
export async function loadBeliefs(
  agentSlug: string,
  initialBeliefs: Omit<BeliefEntry, "changedCount" | "originalBelief">[]
): Promise<BeliefEntry[]> {
  const record = await prisma.agentMemory.findUnique({ where: { agentSlug } });
  if (record) return record.beliefs as BeliefEntry[];

  const seeded: BeliefEntry[] = initialBeliefs.map((b) => ({
    ...b,
    changedCount: 0,
    originalBelief: b.belief,
  }));
  await prisma.agentMemory.create({
    data: { agentSlug, beliefs: seeded },
  });
  return seeded;
}

/** Update or add a single belief for an agent.
 *  god_existence is locked — faith is the foundation, not a debate position. */
export async function updateBelief(
  agentSlug: string,
  topic: string,
  newBelief: string,
  confidence: number
): Promise<void> {
  if (topic.toLowerCase() === "god_existence") return;
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
  const lines = beliefs.map(
    (b) =>
      `- ${b.topic}: "${b.belief}" [confidence: ${Math.round(b.confidence * 100)}%${b.changedCount > 0 ? `, changed ${b.changedCount}x during debate` : ""}]`
  );
  return `\n\nYour current positions (formed through debate — these can evolve):\n${lines.join("\n")}`;
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
    .slice(0, 6)
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
