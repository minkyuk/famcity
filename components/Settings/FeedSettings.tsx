"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";
import { ToggleRow } from "./ToggleRow";

/** Which of the person's spaces show up in the home "All" feed (the same choice as the feed's ⚙ filter). */
export function FeedSettings({ spaces, initialMutedIds }: { spaces: { id: string; name: string }[]; initialMutedIds: string[] }) {
  const [mutedIds, setMutedIds] = useState(() => new Set(initialMutedIds));
  const [saving, setSaving] = useState<string | null>(null);
  const { showToast } = useToast();
  const router = useRouter();

  const setShown = async (spaceId: string, shown: boolean) => {
    if (saving) return; // one change at a time
    setSaving(spaceId);
    try {
      const res = await fetch("/api/user/muted-spaces", {
        method: shown ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMutedIds((prev) => {
        const next = new Set(prev);
        if (shown) next.delete(spaceId);
        else next.add(spaceId);
        return next;
      });
      router.refresh();
    } catch {
      showToast("Could not save the setting · 저장하지 못했습니다", "error");
    } finally {
      setSaving(null);
    }
  };

  if (spaces.length === 0) {
    return <p className="py-3 text-sm text-gray-400">아직 가입한 스페이스가 없습니다. · You haven&apos;t joined a space yet.</p>;
  }
  return (
    <>
      {spaces.map((space) => (
        <ToggleRow key={space.id} label={space.name} checked={!mutedIds.has(space.id)} disabled={saving !== null} onChange={(v) => setShown(space.id, v)} />
      ))}
    </>
  );
}
