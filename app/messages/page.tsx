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

  useEffect(() => {
    fetch("/api/dm")
      .then((r) => r.json())
      .then((d) => { setConversations(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

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
            <Link
              key={conv.partner.id}
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
          ))}
        </div>
      )}
    </div>
  );
}
