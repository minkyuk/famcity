"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";

export function EditSpaceButton({
  spaceId,
  currentDescription,
  currentPurpose,
}: {
  spaceId: string;
  currentDescription: string | null;
  currentPurpose: string | null;
}) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(currentDescription ?? "");
  const [purpose, setPurpose] = useState(currentPurpose ?? "");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const router = useRouter();

  if (!session?.user?.isAdmin) return null;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, purpose }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast("Space updated");
      setOpen(false);
      router.refresh();
    } catch {
      showToast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-orange-500 transition-colors font-medium"
        title="Edit space info"
      >
        Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
            <h2 className="text-base font-bold text-gray-900">Edit space</h2>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Description</label>
              <input
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description shown under the space name"
                maxLength={200}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Agent purpose</label>
              <textarea
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. 'math tutoring for kids' — shapes how space agents interact"
                maxLength={500}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
