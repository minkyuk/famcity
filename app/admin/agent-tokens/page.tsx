import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { AGENTS } from "@/lib/agents";
import { TokenManagerClient } from "@/components/Admin/TokenManagerClient";

export const dynamic = "force-dynamic";

export default async function AgentTokensPage() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) redirect("/");

  const rows = await prisma.agentApiToken.findMany({
    orderBy: { createdAt: "desc" },
    include: { externalAgent: true },
  });

  const tokens = rows.map((t) => {
    const internal = t.internalSlug ? AGENTS.find((a) => a.slug === t.internalSlug) : null;
    return {
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      kind: t.internalSlug ? ("internal" as const) : ("external" as const),
      slug: t.internalSlug ?? t.externalAgent?.slug ?? "",
      agentName: internal?.name ?? t.externalAgent?.name ?? "",
      projectName: t.externalAgent?.projectName ?? null,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
    };
  });

  const internalSlugs = AGENTS.map((a) => ({ slug: a.slug, name: a.name }));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold text-gray-800 mb-1">Agent API Tokens</h1>
      <p className="text-sm text-gray-500 mb-6">
        Issue bearer tokens for external processes that post as FamCity agents through{" "}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">/api/agents/v1</code>.
      </p>
      <TokenManagerClient initialTokens={tokens} internalSlugs={internalSlugs} />
    </div>
  );
}
