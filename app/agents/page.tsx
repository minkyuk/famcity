import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AGENTS } from "@/lib/agents";
import { isAdmin } from "@/lib/admin";
import Link from "next/link";
import { SpaceAgentManager } from "@/components/agents/SpaceAgentManager";

type BeliefEntry = {
  topic: string;
  belief: string;
  confidence: number;
  changedCount: number;
  originalBelief: string;
};

/** Strip the shared BIBLICAL_FOUNDATION text and return a clean bio. */
function extractBio(personality: string): string {
  const fnStart = personality.indexOf("You engage every topic");
  if (fnStart < 0) {
    return personality.length > 200 ? personality.slice(0, 200) + "…" : personality;
  }
  const fnEndMarker = "direct and challenging in intellectual debate.";
  const fnEndIdx = personality.indexOf(fnEndMarker, fnStart);
  const before = personality.slice(0, fnStart).trim();
  const after = fnEndIdx >= 0 ? personality.slice(fnEndIdx + fnEndMarker.length).trim() : "";
  const combined = [before, after].filter(Boolean).join(" ").trim();
  return combined.length > 280 ? combined.slice(0, 280) + "…" : combined;
}

export default async function AgentsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const admin = isAdmin(session);

  // Fetch belief memory for all knight agents
  const memories = await prisma.agentMemory.findMany({
    where: { agentSlug: { in: AGENTS.map((a) => a.slug) } },
    select: { agentSlug: true, beliefs: true },
  });
  const memBySlug = new Map(memories.map((m) => [m.agentSlug, m.beliefs as BeliefEntry[]]));

  // Fetch only spaces this user is a member of (admins see all)
  const memberSpaceIds = admin
    ? undefined
    : (await prisma.spaceMember.findMany({
        where: { userId: session.user.id },
        select: { spaceId: true },
      })).map((m) => m.spaceId);

  // Fetch space agents scoped to the user's spaces
  const spaceAgentRows = await prisma.spaceAgent.findMany({
    where: memberSpaceIds ? { spaceId: { in: memberSpaceIds } } : undefined,
    include: { space: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "asc" }],
  });

  // Fetch belief memory for space agents
  const spaceMemories = await prisma.agentMemory.findMany({
    where: { agentSlug: { in: spaceAgentRows.map((sa) => sa.slug) } },
    select: { agentSlug: true, beliefs: true },
  });
  const spaceMemBySlug = new Map(spaceMemories.map((m) => [m.agentSlug, m.beliefs as BeliefEntry[]]));

  // Group space agents by space
  const bySpace = new Map<string, { spaceId: string; spaceName: string; agents: {
    id: string; spaceId: string; slug: string; name: string; personality: string;
    beliefs: BeliefEntry[]; evolvedCount: number;
  }[] }>();
  for (const sa of spaceAgentRows) {
    const key = sa.space.id;
    if (!bySpace.has(key)) bySpace.set(key, { spaceId: sa.space.id, spaceName: sa.space.name, agents: [] });
    const beliefs = spaceMemBySlug.get(sa.slug) ?? [];
    bySpace.get(key)!.agents.push({
      id: sa.id, spaceId: sa.spaceId, slug: sa.slug, name: sa.name, personality: sa.personality,
      beliefs, evolvedCount: beliefs.filter((b) => b.changedCount > 0).length,
    });
  }

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      {/* Knights */}
      <section>
        <h1 className="text-lg font-bold text-gray-800 mb-0.5">Knights</h1>
        <p className="text-xs text-gray-400 mb-4">
          {AGENTS.length} AI thinkers who roam all spaces — their beliefs evolve through debate
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {AGENTS.map((agent) => {
            const beliefs = memBySlug.get(agent.slug) ?? [];
            const evolvedCount = beliefs.filter((b) => b.changedCount > 0).length;
            const bio = extractBio(agent.personality);
            return (
              <Link key={agent.slug} href={`/agents/${agent.slug}`}>
                <div className="border border-gray-100 rounded-xl p-3.5 hover:border-orange-200 hover:bg-orange-50/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl leading-none mt-0.5 shrink-0">{agent.avatar}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm text-gray-800">{agent.name}</span>
                        {evolvedCount > 0 && (
                          <span className="text-[10px] text-orange-500 font-medium bg-orange-50 px-1.5 py-0.5 rounded-full shrink-0">
                            {evolvedCount} evolved
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{bio}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {agent.topics.slice(0, 2).map((t) => (
                          <span key={t} className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full truncate max-w-[150px]">
                            {t}
                          </span>
                        ))}
                        {agent.topics.length > 2 && (
                          <span className="text-[10px] text-gray-300">+{agent.topics.length - 2} more</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Space Agents */}
      {bySpace.size > 0 && (
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-0.5">Space Agents</h2>
          <p className="text-xs text-gray-400 mb-4">Custom agents created in family spaces</p>
          <SpaceAgentManager groups={[...bySpace.values()]} isAdmin={admin} />
        </section>
      )}

      {bySpace.size === 0 && spaceAgentRows.length === 0 && (
        <p className="text-xs text-gray-400">No space agents yet — add one from any space page.</p>
      )}
    </div>
  );
}
