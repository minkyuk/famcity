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
      if (!res.ok) throw new Error();
      const { code, expiresAt } = await res.json() as { code: string; expiresAt: string };
      const url = `${window.location.origin}/join/${code}`;
      await navigator.clipboard.writeText(url);
      const hours = Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000);
      showToast(`Invite link copied! Expires in ~${hours}h`);
    } catch {
      showToast("Failed to get invite link", "error");
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
