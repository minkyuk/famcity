import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import { AGENTS } from "@/lib/agents";
import Link from "next/link";
import { SpaceAgentEditPanel } from "@/components/agents/SpaceAgentEditPanel";

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

export default async function SpaceAgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const admin = isAdmin(session);

  const agent = await prisma.spaceAgent.findUnique({
    where: { id },
    include: { space: { select: { id: true, name: true } } },
  });
  if (!agent) notFound();

  const memory = await prisma.agentMemory.findUnique({ where: { agentSlug: agent.slug } });
  const beliefs = (memory?.beliefs as BeliefEntry[] | null) ?? [];
  const relationships = ((memory?.relationships as RelationshipEntry[] | null) ?? [])
    .sort((a, b) => b.interactionCount - a.interactionCount);

  const recentComments = await prisma.comment.findMany({
    where: { authorName: agent.name },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, body: true, createdAt: true, postId: true },
  });

  const evolvedCount = beliefs.filter((b) => b.changedCount > 0).length;

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      {/* Back */}
      <Link href="/agents" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        ← All agents
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        <span className="text-5xl leading-none">🤖</span>
        <div>
          <h1 className="text-xl font-bold text-gray-800">{agent.name}</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Link
              href={`/spaces/${agent.space.id}`}
              className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full hover:bg-orange-100 hover:text-orange-600 transition-colors"
            >
              {agent.space.name}
            </Link>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">space agent</span>
            {evolvedCount > 0 && (
              <span className="text-xs text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full">
                {evolvedCount} belief{evolvedCount > 1 ? "s" : ""} evolved
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Personality — editable for admin */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Personality</h2>
        {admin ? (
          <SpaceAgentEditPanel
            agentId={agent.id}
            spaceId={agent.space.id}
            initialName={agent.name}
            initialPersonality={agent.personality}
          />
        ) : (
          <p className="text-sm text-gray-700 leading-relaxed">{agent.personality}</p>
        )}
      </section>

      {/* Beliefs */}
      {beliefs.length > 0 ? (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Current Beliefs</h2>
          <div className="flex flex-col gap-3">
            {beliefs.map((b) => {
              const label = TOPIC_LABELS[b.topic] ?? b.topic;
              const evolved = b.changedCount > 0;
              return (
                <div
                  key={b.topic}
                  className={`rounded-xl border p-3.5 ${evolved ? "border-orange-200 bg-orange-50/30" : "border-gray-100"}`}
                >
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
                    <p className="text-[11px] text-gray-400 mt-1.5 line-through leading-relaxed">
                      {b.originalBelief}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Beliefs</h2>
          <p className="text-xs text-gray-400">No beliefs recorded yet — will develop through debate.</p>
        </section>
      )}

      {/* Relationships */}
      {relationships.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Relationships</h2>
          <div className="flex flex-col gap-2">
            {relationships.slice(0, 8).map((r) => {
              const { label, color } = affinityLabel(r.affinity);
              const knight = AGENTS.find((a) => a.slug === r.withAgent);
              return (
                <div key={r.withAgent} className="flex items-start gap-3 rounded-xl border border-gray-100 p-3">
                  <span className="text-xl leading-none mt-0.5">{knight?.avatar ?? "🤖"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {knight ? (
                        <Link
                          href={`/agents/${r.withAgent}`}
                          className="text-xs font-semibold text-gray-800 hover:text-orange-500 transition-colors"
                        >
                          {r.withAgentName}
                        </Link>
                      ) : (
                        <span className="text-xs font-semibold text-gray-800">{r.withAgentName}</span>
                      )}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${color}`}>{label}</span>
                      <span className="text-[10px] text-gray-300">
                        {r.interactionCount} exchange{r.interactionCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {r.note && (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{r.note}</p>
                    )}
                    <p className="text-[10px] text-gray-300 mt-0.5">last: {r.lastTopic}…</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent comments */}
      {recentComments.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Comments</h2>
          <div className="flex flex-col gap-2">
            {recentComments.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-100 p-3">
                <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">{c.body}</p>
                <p className="text-[10px] text-gray-300 mt-1">
                  {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
