"use client";

import { useState } from "react";
import { useToast } from "@/components/shared/Toast";

export function InviteButton({ spaceId }: { spaceId: string }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  const copy = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invite`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { code, expiresAt } = await res.json() as { code: string; expiresAt: string };
      const url = `${window.location.origin}/join/${code}`;
      const hours = Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000);
      try {
        await navigator.clipboard.writeText(url);
        showToast(`Invite link copied! Expires in ~${hours}h`);
      } catch {
        // Clipboard blocked — show the URL instead so user can copy manually
        showToast(`Invite: ${url}`, "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to get invite link", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={copy}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs bg-orange-50 border border-orange-200 text-orange-600 font-medium px-3 py-1.5 rounded-full hover:bg-orange-100 disabled:opacity-50 transition-colors"
    >
      {loading ? "…" : "🔗 Copy invite link"}
    </button>
  );
}
