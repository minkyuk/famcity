"use client";

import { useToast } from "@/components/shared/Toast";

export function InviteButton({ inviteCode }: { inviteCode: string }) {
  const { showToast } = useToast();

  const copy = () => {
    const url = `${window.location.origin}/join/${inviteCode}`;
    navigator.clipboard.writeText(url);
    showToast("Invite link copied!");
  };

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 text-xs bg-orange-50 border border-orange-200 text-orange-600 font-medium px-3 py-1.5 rounded-full hover:bg-orange-100 transition-colors"
    >
      🔗 Copy invite link
    </button>
  );
}
