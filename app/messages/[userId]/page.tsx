"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";

type DMMessage = {
  id: string;
  content: string;
  createdAt: string;
  fromUserId: string;
  fromUser: { id: string; name: string | null; image: string | null };
};

type OtherUser = { id: string; name: string | null; image: string | null };

function Avatar({ name, image, size = 8 }: { name: string | null; image: string | null; size?: number }) {
  const cls = `relative w-${size} h-${size} rounded-full overflow-hidden shrink-0`;
  if (image) {
    return (
      <div className={cls}>
        <Image src={image} alt={name ?? "User"} fill className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div className={`w-${size} h-${size} rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-600 shrink-0`}>
      {(name ?? "?")[0]}
    </div>
  );
}

export default function ThreadPage() {
  const { data: session } = useSession();
  const { userId: otherId } = useParams<{ userId: string }>();

  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [other, setOther] = useState<OtherUser | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestIdRef = useRef<string | null>(null);

  const fetchMessages = useCallback(async (initial = false) => {
    const res = await fetch(`/api/dm/${otherId}`);
    if (!res.ok) return;
    const data = await res.json();
    const msgs: DMMessage[] = data.messages ?? data;
    if (initial) {
      setMessages(msgs);
      setOther(data.other ?? null);
      setLoading(false);
    } else {
      // Only append truly new messages
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newer = msgs.filter((m) => !existingIds.has(m.id));
        return newer.length > 0 ? [...prev, ...newer] : prev;
      });
    }
    if (msgs.length > 0) latestIdRef.current = msgs[msgs.length - 1].id;
  }, [otherId]);

  useEffect(() => {
    fetchMessages(true);
    pollRef.current = setInterval(() => fetchMessages(false), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${otherId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body.trim() }),
      });
      if (!res.ok) throw new Error();
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setBody("");
    } finally {
      setSending(false);
    }
  };

  if (!session) return null;

  return (
    <div className="max-w-lg mx-auto flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <Link href="/messages" className="text-gray-400 hover:text-gray-600 text-sm shrink-0">
          ← Back
        </Link>
        {other && (
          <>
            <Avatar name={other.name} image={other.image} size={8} />
            <p className="font-semibold text-gray-900">{other.name ?? "User"}</p>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-3">
        {loading ? (
          <div className="text-center text-gray-400 text-sm py-8">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">
            No messages yet. Say hi! 👋
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.fromUserId === session.user.id;
            return (
              <div key={msg.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                {!isMe && <Avatar name={msg.fromUser.name} image={msg.fromUser.image} size={7} />}
                <div className={`max-w-[75%] flex flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}>
                  <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    isMe
                      ? "bg-orange-500 text-white rounded-br-sm"
                      : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}>
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-gray-400 px-1">
                    {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} className="flex gap-2 pt-3 border-t border-gray-100">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Message ${other?.name ?? ""}…`}
          className="flex-1 text-sm border border-gray-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-300"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="bg-orange-500 text-white text-sm font-semibold px-4 py-2.5 rounded-full hover:bg-orange-600 disabled:opacity-40 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
