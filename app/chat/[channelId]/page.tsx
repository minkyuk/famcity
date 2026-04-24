"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

function linkify(text: string, isOwn: boolean): React.ReactNode {
  const re = /https?:\/\/[^\s)>\]]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    parts.push(
      <a key={m.index} href={url} target="_blank" rel="noopener noreferrer"
        className={`underline break-all ${isOwn ? "text-blue-200" : "text-blue-500"}`}>
        {url}
      </a>
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 1 ? <>{parts}</> : text;
}

type Message = {
  id: string;
  userId: string;
  userName: string;
  userImage: string | null;
  content: string;
  createdAt: string;
};

type OnlineUser = {
  userId: string;
  name: string;
  image: string | null;
  channelId: string | null;
};

type Channel = {
  id: string;
  name: string;
  description: string | null;
  isGlobal: boolean;
  hasPassword: boolean;
};

function Avatar({ name, image, size = 32 }: { name: string; image?: string | null; size?: number }) {
  if (image) {
    return <Image src={image} alt={name} width={size} height={size} className="rounded-full" unoptimized />;
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-600 shrink-0"
    >
      {name[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

export default function ChatRoomPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const { data: session } = useSession();
  const router = useRouter();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [joined, setJoined] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const lastSeenRef = useRef<string | null>(null);

  // Fetch channel info
  useEffect(() => {
    fetch("/api/chat/channels")
      .then((r) => r.json())
      .then((channels: Channel[]) => {
        const ch = channels.find((c) => c.id === channelId);
        if (!ch) { router.push("/chat"); return; }
        setChannel(ch);
        setLoadingChannel(false);
        // Auto-join if no password
        if (!ch.hasPassword) setJoined(true);
      });
  }, [channelId, router]);

  // Load history after joining
  useEffect(() => {
    if (!joined) return;
    setLoadingHistory(true);
    fetch(`/api/chat/channels/${channelId}/messages`)
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages ?? []);
        setNextCursor(d.nextCursor ?? null);
        if (d.messages?.length > 0) {
          lastSeenRef.current = d.messages[d.messages.length - 1].createdAt;
        }
        setLoadingHistory(false);
      });
  }, [joined, channelId]);

  // SSE for real-time messages + presence
  useEffect(() => {
    if (!joined) return;

    const connect = () => {
      const url = `/api/chat/channels/${channelId}/sse${lastSeenRef.current ? `?since=${encodeURIComponent(lastSeenRef.current)}` : ""}`;
      const es = new EventSource(url);
      sseRef.current = es;

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === "messages" && payload.data.length > 0) {
            setMessages((prev) => {
              const ids = new Set(prev.map((m) => m.id));
              const fresh = payload.data.filter((m: Message) => !ids.has(m.id));
              if (fresh.length === 0) return prev;
              lastSeenRef.current = fresh[fresh.length - 1].createdAt;
              return [...prev, ...fresh];
            });
          }
          if (payload.type === "presence") {
            setOnline(payload.data);
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      sseRef.current?.close();
      // Clear presence on leave
      fetch("/api/chat/online", { method: "DELETE", keepalive: true });
    };
  }, [joined, channelId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const res = await fetch(`/api/chat/channels/${channelId}/messages?cursor=${nextCursor}`);
    const d = await res.json();
    setMessages((prev) => [...(d.messages ?? []), ...prev]);
    setNextCursor(d.nextCursor ?? null);
  };

  const joinWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    const res = await fetch(`/api/chat/channels/${channelId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setJoined(true);
    } else {
      const d = await res.json();
      setPwError(d.error ?? "Wrong password");
    }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        lastSeenRef.current = msg.createdAt;
        return [...prev, msg];
      });
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (loadingChannel) {
    return <div className="py-24 text-center text-gray-400 text-sm">Loading…</div>;
  }

  if (!channel) return null;

  // Password gate
  if (channel.hasPassword && !joined) {
    return (
      <div className="max-w-sm mx-auto mt-24 flex flex-col gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4">
          <div className="text-center">
            <p className="text-2xl mb-1">🔒</p>
            <h2 className="text-lg font-bold text-gray-900">{channel.name}</h2>
            {channel.description && <p className="text-sm text-gray-400">{channel.description}</p>}
          </div>
          <form onSubmit={joinWithPassword} className="flex flex-col gap-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter channel password"
              autoFocus
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
            {pwError && <p className="text-xs text-red-500">{pwError}</p>}
            <button
              type="submit"
              className="bg-accent text-white text-sm font-semibold py-2 rounded-full hover:bg-orange-600 transition-colors"
            >
              Join
            </button>
          </form>
          <Link href="/chat" className="text-xs text-gray-400 hover:text-gray-600 text-center">
            ← Back to channels
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 shrink-0">
          <Link href="/chat" className="text-gray-400 hover:text-gray-600 text-sm">
            ←
          </Link>
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">
              {channel.isGlobal ? "🌍 " : channel.hasPassword ? "🔒 " : "# "}
              {channel.name}
            </h2>
            {channel.description && (
              <p className="text-xs text-gray-400">{channel.description}</p>
            )}
          </div>
          <div className="ml-auto text-xs text-green-500 font-medium">
            {online.length > 0 && `● ${online.length} online`}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {nextCursor && (
            <button
              onClick={loadMore}
              className="text-xs text-orange-500 hover:text-orange-600 font-medium text-center py-1"
            >
              Load older messages
            </button>
          )}

          {loadingHistory ? (
            <div className="text-center text-gray-400 text-sm py-8">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-8">
              No messages yet. Say hi! 👋
            </div>
          ) : (
            messages.map((msg, i) => {
              const isOwn = msg.userId === session?.user?.id;
              const prevMsg = messages[i - 1];
              const sameSender = prevMsg?.userId === msg.userId;
              return (
                <div key={msg.id} className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                  {!sameSender && (
                    <div className="shrink-0 mt-1">
                      <Avatar name={msg.userName} image={msg.userImage} size={28} />
                    </div>
                  )}
                  {sameSender && <div className="w-7 shrink-0" />}
                  <div className={`flex flex-col gap-0.5 max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
                    {!sameSender && (
                      <p className={`text-xs text-gray-400 px-1 ${isOwn ? "text-right" : ""}`}>
                        {isOwn ? "You" : msg.userName}
                        {" · "}
                        {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                      </p>
                    )}
                    <div
                      className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        isOwn
                          ? "bg-accent text-white rounded-tr-sm"
                          : "bg-gray-100 text-gray-800 rounded-tl-sm"
                      }`}
                    >
                      {linkify(msg.content, isOwn)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-gray-100 shrink-0">
          <form onSubmit={send} className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message… (Enter to send, Shift+Enter for new line)"
              rows={1}
              maxLength={2000}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 min-h-[38px] max-h-32"
              style={{ height: "auto" }}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-orange-600 disabled:opacity-40 transition-colors shrink-0"
            >
              Send
            </button>
          </form>
        </div>
      </div>

      {/* Online users sidebar */}
      <aside className="hidden md:flex w-48 shrink-0 flex-col gap-2">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Online · {online.length}
          </p>
          {online.length === 0 ? (
            <p className="text-xs text-gray-300 italic">Just you for now</p>
          ) : (
            online.map((u) => (
              <Link
                key={u.userId}
                href={`/profile/${u.userId}`}
                className="flex items-center gap-2 hover:bg-gray-50 rounded-lg p-1 transition-colors"
              >
                <div className="relative">
                  <Avatar name={u.name} image={u.image} size={28} />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 border-2 border-white rounded-full" />
                </div>
                <span className="text-xs text-gray-700 font-medium truncate">{u.name}</span>
              </Link>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
