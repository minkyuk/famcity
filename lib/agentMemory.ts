import { prisma } from "@/lib/prisma";

export type BeliefEntry = {
  topic: string;
  belief: string;       // current stance in 1-2 sentences
  confidence: number;   // 0.0–1.0
  changedCount: number; // times this belief has shifted during debate
  originalBelief: string; // what they believed at the start
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

/** Update or add a single belief for an agent. */
export async function updateBelief(
  agentSlug: string,
  topic: string,
  newBelief: string,
  confidence: number
): Promise<void> {
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
