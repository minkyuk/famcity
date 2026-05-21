"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Space { id: string; name: string; }

interface Props {
  spaces: Space[];
  initialMutedIds: string[];
}

export function SpaceFeedFilter({ spaces, initialMutedIds }: Props) {
  const [open, setOpen] = useState(false);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set(initialMutedIds));
  const [saving, setSaving] = useState<string | null>(null);
  const router = useRouter();

  const toggle = async (spaceId: string) => {
    const isMuted = mutedIds.has(spaceId);
    setSaving(spaceId);
    try {
      await fetch("/api/user/muted-spaces", {
        method: isMuted ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      setMutedIds((prev) => {
        const next = new Set(prev);
        isMuted ? next.delete(spaceId) : next.add(spaceId);
        return next;
      });
      router.refresh();
    } finally {
      setSaving(null);
    }
  };

  const mutedCount = mutedIds.size;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <span>⚙ Feed filter</span>
        {mutedCount > 0 && (
          <span className="bg-orange-100 text-orange-600 font-medium px-1.5 py-0.5 rounded-full text-[10px]">
            {mutedCount} hidden
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-7 left-0 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-48 flex flex-col gap-1">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Show in All feed
          </p>
          {spaces.map((space) => {
            const visible = !mutedIds.has(space.id);
            return (
              <button
                key={space.id}
                onClick={() => toggle(space.id)}
                disabled={saving === space.id}
                className="flex items-center gap-2 text-sm text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 w-full"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                  visible ? "bg-orange-500 border-orange-500 text-white" : "border-gray-300"
                }`}>
                  {visible && "✓"}
                </span>
                <span className="truncate text-gray-700">{space.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Click-outside to close */}
      {open && (
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
