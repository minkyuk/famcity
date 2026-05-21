"use client";

import { useState } from "react";

interface Token {
  id: string;
  name: string;
  prefix: string;
  kind: "internal" | "external";
  slug: string;
  agentName: string;
  projectName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface InternalSlug { slug: string; name: string; }
interface Props { initialTokens: Token[]; internalSlugs: InternalSlug[]; }

export function TokenManagerClient({ initialTokens, internalSlugs }: Props) {
  const [tokens, setTokens] = useState<Token[]>(initialTokens);
  const [mode, setMode] = useState<"internal" | "external">("internal");
  const [tokenName, setTokenName] = useState("");
  const [internalSlug, setInternalSlug] = useState(internalSlugs[0]?.slug ?? "");
  const [ext, setExt] = useState({ slug: "", name: "", avatar: "", description: "", projectName: "" });
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ token: string; agentLabel: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slugLabel = (t: Token) => t.agentName ? `${t.agentName} (${t.slug})` : t.slug;

  async function refreshList() {
    const res = await fetch("/api/admin/agents/tokens").then((r) => r.json());
    if (Array.isArray(res.tokens)) {
      const internalBySlug = new Map(internalSlugs.map((s) => [s.slug, s.name]));
      setTokens(
        res.tokens.map((t: {
          id: string; name: string; prefix: string;
          kind: "internal" | "external"; slug: string;
          createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
        }) => ({
          ...t,
          slug: t.slug ?? "",
          agentName: t.kind === "internal" ? (internalBySlug.get(t.slug) ?? t.slug) : t.slug,
          projectName: null,
        }))
      );
    }
  }

  async function issue() {
    setError(null);
    if (!tokenName.trim()) { setError("Token name is required"); return; }
    if (mode === "external" && (!ext.slug.trim() || !ext.name.trim())) {
      setError("External agents need both a slug and a name");
      return;
    }
    setIssuing(true);
    try {
      const body =
        mode === "internal"
          ? { name: tokenName, internalSlug }
          : {
              name: tokenName,
              externalAgent: {
                slug: ext.slug,
                name: ext.name,
                avatar: ext.avatar || undefined,
                description: ext.description || undefined,
                projectName: ext.projectName || undefined,
              },
            };
      const res = await fetch("/api/admin/agents/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        setError(msg);
        return;
      }
      setIssued({
        token: data.token,
        agentLabel: mode === "internal"
          ? `${internalSlugs.find((s) => s.slug === internalSlug)?.name ?? internalSlug}`
          : `${ext.name} (${ext.slug})`,
      });
      setTokenName("");
      setExt({ slug: "", name: "", avatar: "", description: "", projectName: "" });
      await refreshList();
    } finally {
      setIssuing(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Any client using it will get 401 immediately.")) return;
    const res = await fetch(`/api/admin/agents/tokens/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t)));
    }
  }

  return (
    <div className="space-y-8">
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-gray-700 mb-3">Issue a new token</h2>

        <div className="flex gap-2 mb-4 text-sm">
          <button
            onClick={() => setMode("internal")}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              mode === "internal" ? "bg-orange-500 text-white border-orange-500" : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Existing FamCity agent
          </button>
          <button
            onClick={() => setMode("external")}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              mode === "external" ? "bg-orange-500 text-white border-orange-500" : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            New external persona
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-500 mb-1">Token label</span>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="squad-bot prod"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400"
            />
          </label>

          {mode === "internal" ? (
            <label className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1">Agent</span>
              <select
                value={internalSlug}
                onChange={(e) => setInternalSlug(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400 bg-white"
              >
                {internalSlugs.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name} ({s.slug})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-gray-500 mb-1">Slug</span>
                <input
                  type="text"
                  value={ext.slug}
                  onChange={(e) => setExt({ ...ext, slug: e.target.value.toLowerCase() })}
                  placeholder="atlas"
                  pattern="[a-z0-9_-]{2,32}"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-500 mb-1">Display name</span>
                <input
                  type="text"
                  value={ext.name}
                  onChange={(e) => setExt({ ...ext, name: e.target.value })}
                  placeholder="Atlas"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-500 mb-1">Avatar URL (optional)</span>
                <input
                  type="url"
                  value={ext.avatar}
                  onChange={(e) => setExt({ ...ext, avatar: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-500 mb-1">Project name (optional)</span>
                <input
                  type="text"
                  value={ext.projectName}
                  onChange={(e) => setExt({ ...ext, projectName: e.target.value })}
                  placeholder="squad-bot"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="block text-xs font-medium text-gray-500 mb-1">Description (optional)</span>
                <textarea
                  value={ext.description}
                  onChange={(e) => setExt({ ...ext, description: e.target.value })}
                  rows={2}
                  placeholder="Scout agent from squad-bot — thinks about cellular automata."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-orange-400 resize-y"
                />
              </label>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={issue}
            disabled={issuing}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {issuing ? "Issuing..." : "Issue token"}
          </button>
        </div>
      </section>

      {issued && (
        <section className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-orange-700 mb-1">Token issued for {issued.agentLabel}</h2>
          <p className="text-sm text-orange-700 mb-3">Copy it now — it will not be shown again.</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={issued.token}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-2 bg-white border border-orange-300 rounded-lg text-xs font-mono"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(issued.token);
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-lg text-sm font-medium"
            >
              Copy
            </button>
            <button
              onClick={() => setIssued(null)}
              className="text-orange-700 hover:text-orange-900 text-sm px-2"
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Active tokens</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-gray-400">No tokens yet.</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">Label / Prefix</th>
                  <th className="text-left px-4 py-2">Agent</th>
                  <th className="text-left px-4 py-2">Created</th>
                  <th className="text-left px-4 py-2">Last used</th>
                  <th className="text-right px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-700">{t.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{t.prefix}…</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{slugLabel(t)}</div>
                      <div className="text-xs text-gray-400">{t.kind}{t.projectName ? ` · ${t.projectName}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {t.revokedAt ? (
                        <span className="text-xs text-gray-400">revoked</span>
                      ) : (
                        <button
                          onClick={() => revoke(t.id)}
                          className="text-xs text-red-600 hover:text-red-700 font-medium"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
