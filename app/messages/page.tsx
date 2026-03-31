"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";

type Conversation = {
  partner: { id: string; name: string | null; image: string | null };
  lastMessage: string;
  lastAt: string;
  unread: number;
};

function Avatar({ name, image }: { name: string | null; image: string | null }) {
  if (image) {
    return (
      <div className="relative w-10 h-10 rounded-full overflow-hidden shrink-0">
        <Image src={image} alt={name ?? "User"} fill className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600 shrink-0">
      {(name ?? "?")[0]}
    </div>
  );
}

export default function MessagesPage() {
  const { data: session } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dm")
      .then((r) => r.json())
      .then((d) => { setConversations(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleDelete(partnerId: string, partnerName: string | null, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete all messages with ${partnerName ?? "this person"}?`)) return;
    setDeleting(partnerId);
    try {
      await fetch(`/api/dm/${partnerId}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.partner.id !== partnerId));
    } finally {
      setDeleting(null);
    }
  }

  if (!session) return null;

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-gray-900">✉️ Messages</h1>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No messages yet. Tap 💬 on someone&apos;s profile to start a conversation.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {conversations.map((conv) => (
            <div key={conv.partner.id} className="relative group">
              <Link
                href={`/messages/${conv.partner.id}`}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 hover:border-orange-200 transition-colors"
              >
                <div className="relative">
                  <Avatar name={conv.partner.name} image={conv.partner.image} />
                  {conv.unread > 0 && (
                    <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                      {conv.unread > 9 ? "9+" : conv.unread}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm font-semibold truncate ${conv.unread > 0 ? "text-gray-900" : "text-gray-700"}`}>
                      {conv.partner.name ?? "Unknown"}
                    </p>
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {formatDistanceToNow(new Date(conv.lastAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${conv.unread > 0 ? "text-gray-700 font-medium" : "text-gray-400"}`}>
                    {conv.lastMessage}
                  </p>
                </div>
              </Link>
              <button
                onClick={(e) => handleDelete(conv.partner.id, conv.partner.name, e)}
                disabled={deleting === conv.partner.id}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"
                title="Delete conversation"
              >
                {deleting === conv.partner.id ? (
                  <span className="text-[11px] text-gray-400">…</span>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
