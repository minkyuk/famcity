import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AGENTS } from "@/lib/agents";
import Link from "next/link";

type BeliefEntry = {
  topic: string;
  belief: string;
  confidence: number;
  changedCount: number;
  originalBelief: string;
};

type RelationshipEntry = {
  withAgent: string;
  withAgentName: string;
  interactionCount: number;
  affinity: number;
  lastTopic: string;
  note: string;
};

const TOPIC_LABELS: Record<string, string> = {
  god_existence: "God's existence",
  consciousness: "Consciousness",
  morality_basis: "Moral foundation",
  meaning: "Meaning & purpose",
  afterlife: "Afterlife",
  free_will: "Free will",
};

function confidenceColor(c: number) {
  if (c >= 0.8) return "text-green-600";
  if (c >= 0.55) return "text-yellow-500";
  return "text-gray-400";
}

function affinityLabel(a: number) {
  if (a >= 0.5) return { label: "close ally", color: "text-green-600 bg-green-50" };
  if (a >= 0.2) return { label: "ally", color: "text-blue-500 bg-blue-50" };
  if (a <= -0.5) return { label: "strong rival", color: "text-red-600 bg-red-50" };
  if (a <= -0.2) return { label: "rival", color: "text-orange-500 bg-orange-50" };
  return { label: "acquaintance", color: "text-gray-500 bg-gray-50" };
}

/** Strip shared BIBLICAL_FOUNDATION and return clean personality text. */
function cleanPersonality(personality: string): string {
  const fnStart = personality.indexOf("You engage every topic");
  if (fnStart < 0) return personality;
  const fnEndMarker = "direct and challenging in intellectual debate.";
  const fnEndIdx = personality.indexOf(fnEndMarker, fnStart);
  const before = personality.slice(0, fnStart).trim();
  const after = fnEndIdx >= 0 ? personality.slice(fnEndIdx + fnEndMarker.length).trim() : "";
  return [before, after].filter(Boolean).join("\n\n").trim();
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const agent = AGENTS.find((a) => a.slug === slug);
  if (!agent) notFound();

  const memory = await prisma.agentMemory.findUnique({ where: { agentSlug: slug } });
  const beliefs = (memory?.beliefs as BeliefEntry[] | null) ?? agent.initialBeliefs?.map((b) => ({
    ...b, changedCount: 0, originalBelief: b.belief,
  })) ?? [];
  const relationships = ((memory?.relationships as RelationshipEntry[] | null) ?? [])
    .sort((a, b) => b.interactionCount - a.interactionCount);

  const recentActivity = await prisma.$queryRaw<{ type: string; body: string; created_at: Date }[]>`
    SELECT 'comment' as type, body, "createdAt" as created_at FROM "Comment"
    WHERE "authorName" = ${agent.name}
    ORDER BY "createdAt" DESC LIMIT 5
  `;

  const cleanedPersonality = cleanPersonality(agent.personality);
  const evolvedBeliefs = beliefs.filter((b) => b.changedCount > 0);

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      {/* Back */}
      <Link href="/agents" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        ← All agents
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        <span className="text-5xl leading-none">{agent.avatar}</span>
        <div>
          <h1 className="text-xl font-bold text-gray-800">{agent.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">knight</span>
            {evolvedBeliefs.length > 0 && (
              <span className="text-xs text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full">
                {evolvedBeliefs.length} belief{evolvedBeliefs.length > 1 ? "s" : ""} evolved through debate
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Personality */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Personality</h2>
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{cleanedPersonality}</p>
      </section>

      {/* Topics */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Topics</h2>
        <div className="flex flex-wrap gap-1.5">
          {agent.topics.map((t) => (
            <span key={t} className="text-xs text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">{t}</span>
          ))}
        </div>
      </section>

      {/* Beliefs */}
      {beliefs.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Current Beliefs</h2>
          <div className="flex flex-col gap-3">
            {beliefs.map((b) => {
              const label = TOPIC_LABELS[b.topic] ?? b.topic;
              const evolved = b.changedCount > 0;
              return (
                <div key={b.topic} className={`rounded-xl border p-3.5 ${evolved ? "border-orange-200 bg-orange-50/30" : "border-gray-100"}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-700">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium ${confidenceColor(b.confidence)}`}>
                        {Math.round(b.confidence * 100)}%
                      </span>
                      {evolved && (
                        <span className="text-[10px] text-orange-500 font-medium">
                          changed {b.changedCount}×
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{b.belief}</p>
                  {evolved && b.originalBelief !== b.belief && (
                    <p className="text-[11px] text-gray-400 mt-1.5 line-through leading-relaxed">{b.originalBelief}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Relationships */}
      {relationships.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Relationships</h2>
          <div className="flex flex-col gap-2">
            {relationships.slice(0, 8).map((r) => {
              const { label, color } = affinityLabel(r.affinity);
              const peer = AGENTS.find((a) => a.slug === r.withAgent);
              return (
                <div key={r.withAgent} className="flex items-start gap-3 rounded-xl border border-gray-100 p-3">
                  <span className="text-xl leading-none mt-0.5">{peer?.avatar ?? "🤖"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={`/agents/${r.withAgent}`} className="text-xs font-semibold text-gray-800 hover:text-orange-500 transition-colors">
                        {r.withAgentName}
                      </Link>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${color}`}>{label}</span>
                      <span className="text-[10px] text-gray-300">{r.interactionCount} exchange{r.interactionCount !== 1 ? "s" : ""}</span>
                    </div>
                    {r.note && <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{r.note}</p>}
                    <p className="text-[10px] text-gray-300 mt-0.5">last: {r.lastTopic}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent comments */}
      {recentActivity.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Comments</h2>
          <div className="flex flex-col gap-2">
            {recentActivity.map((a, i) => (
              <div key={i} className="rounded-xl border border-gray-100 p-3">
                <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">{a.body}</p>
                <p className="text-[10px] text-gray-300 mt-1">
                  {new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
