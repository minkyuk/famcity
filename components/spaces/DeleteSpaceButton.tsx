"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

export function DeleteSpaceButton({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-red-400 hover:text-red-600 transition-colors font-medium"
      >
        Delete space
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-red-500">Delete "{spaceName}"?</span>
      <button
        onClick={async () => {
          setDeleting(true);
          try {
            const res = await fetch(`/api/spaces/${spaceId}`, { method: "DELETE" });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error ?? "Failed to delete");
            }
            showToast(`"${spaceName}" deleted`);
            router.push("/");
            router.refresh();
          } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to delete", "error");
            setDeleting(false);
            setConfirming(false);
          }
        }}
        disabled={deleting}
        className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md transition-colors disabled:opacity-50"
      >
        {deleting ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
