"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

export function EditAgentDescription({
  slug,
  initialDescription,
}: {
  slug: string;
  initialDescription: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialDescription ?? "");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  if (!editing) {
    return (
      <div className="flex items-start gap-2 group">
        {initialDescription ? (
          <p className="text-sm text-gray-600 leading-relaxed flex-1">{initialDescription}</p>
        ) : (
          <p className="text-sm text-gray-300 italic flex-1">No description yet.</p>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-gray-300 hover:text-orange-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Write a short public description for this knight…"
        maxLength={1000}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            setSaving(true);
            try {
              const res = await fetch(`/api/agents/${slug}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: value }),
              });
              if (!res.ok) throw new Error("Failed");
              showToast("Description saved");
              setEditing(false);
              router.refresh();
            } catch {
              showToast("Failed to save", "error");
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => { setValue(initialDescription ?? ""); setEditing(false); }}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
        <span className="text-[11px] text-gray-300 ml-auto">{value.length}/1000</span>
      </div>
    </div>
  );
}
