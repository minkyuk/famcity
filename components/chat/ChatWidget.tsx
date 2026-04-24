"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";

type Channel = {
  id: string;
  name: string;
  description: string | null;
  isGlobal: boolean;
  hasPassword: boolean;
  spaceId: string | null;
  space: { name: string } | null;
  _count: { messages: number; presence: number };
};

type Message = {
  id: string;
  userId: string;
  userName: string;
  userImage: string | null;
  content: string;
  createdAt: string;
};

type OnlineUser = { userId: string; name: string; image: string | null };

function Avatar({ name, image, size = 24 }: { name: string; image?: string | null; size?: number }) {
  if (image) {
    return (
      <div className="relative rounded-full overflow-hidden shrink-0" style={{ width: size, height: size }}>
        <Image src={image} alt={name} fill className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-600 shrink-0">
      {name[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

const LS_KEY = "chat_last_seen";

export function ChatWidget() {
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);

  // Room state
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Password gate
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");

  // Unread notification count
  const [unread, setUnread] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Poll for unread count when widget is closed
  const fetchUnread = () => {
    const since = localStorage.getItem(LS_KEY) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fetch(`/api/chat/unread?since=${encodeURIComponent(since)}`)
      .then((r) => r.json())
      .then((d: { count?: number }) => { if (typeof d.count === "number") setUnread(d.count); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!session) return;
    if (open) {
      // Widget opened — clear badge and save current time as last-seen
      setUnread(0);
      localStorage.setItem(LS_KEY, new Date().toISOString());
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    } else {
      // Widget closed — start polling every 30s
      fetchUnread();
      pollRef.current = setInterval(fetchUnread, 30_000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  // Load channels when opened
  useEffect(() => {
    if (!open || !session) return;
    fetch("/api/chat/channels").then((r) => r.json()).then((d) => Array.isArray(d) && setChannels(d));
  }, [open, session]);

  // Open a channel
  const openChannel = (ch: Channel) => {
    sseRef.current?.close();
    setActiveChannel(ch);
    setMessages([]);
    setNextCursor(null);
    lastSeenRef.current = null;
    setPwError("");
    setPassword("");

    if (ch.hasPassword) {
      setNeedsPassword(true);
      return;
    }
    setNeedsPassword(false);
    loadChannel(ch.id);
  };

  const loadChannel = (channelId: string) => {
    setLoadingMsgs(true);
    fetch(`/api/chat/channels/${channelId}/messages`)
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages ?? []);
        setNextCursor(d.nextCursor ?? null);
        if (d.messages?.length > 0) lastSeenRef.current = d.messages[d.messages.length - 1].createdAt;
        setLoadingMsgs(false);
        connectSSE(channelId);
      });
  };

  const joinWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChannel) return;
    setPwError("");
    const res = await fetch(`/api/chat/channels/${activeChannel.id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setNeedsPassword(false);
      loadChannel(activeChannel.id);
    } else {
      const d = await res.json();
      setPwError(d.error ?? "Wrong password");
    }
  };

  const connectSSE = (channelId: string) => {
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
            if (!fresh.length) return prev;
            lastSeenRef.current = fresh[fresh.length - 1].createdAt;
            return [...prev, ...fresh];
          });
        }
        if (payload.type === "presence") setOnline(payload.data);
      } catch {}
    };
    es.onerror = () => { es.close(); setTimeout(() => connectSSE(channelId), 3000); };
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Close SSE when widget closes or channel changes
  useEffect(() => {
    if (!open) {
      sseRef.current?.close();
      if (activeChannel) fetch("/api/chat/online", { method: "DELETE", keepalive: true });
    }
  }, [open]);

  const goBack = () => {
    sseRef.current?.close();
    fetch("/api/chat/online", { method: "DELETE", keepalive: true });
    setActiveChannel(null);
    setMessages([]);
    setNeedsPassword(false);
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeChannel || !input.trim() || sending) return;
    const text = input.trim();
    setSending(true);
    setInput("");
    const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]);
      lastSeenRef.current = msg.createdAt;
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const loadMore = async () => {
    if (!activeChannel || !nextCursor) return;
    const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages?cursor=${nextCursor}`);
    const d = await res.json();
    setMessages((prev) => [...(d.messages ?? []), ...prev]);
    setNextCursor(d.nextCursor ?? null);
  };

  if (!mounted || !session) return null;

  const globalChannels = channels.filter((c) => c.isGlobal);
  const spaceChannels = channels.filter((c) => !c.isGlobal);
  const bySpace = spaceChannels.reduce<Record<string, Channel[]>>((acc, ch) => {
    const key = ch.space?.name ?? "Other";
    acc[key] = [...(acc[key] ?? []), ch];
    return acc;
  }, {});

  const widget = (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col items-end gap-2">
      {/* Panel */}
      {open && (
        <div className="w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden" style={{ height: 480 }}>
          {/* Header */}
          <div className="px-4 py-3 bg-accent text-white flex items-center justify-between shrink-0">
            {activeChannel ? (
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={goBack} className="text-white/80 hover:text-white text-lg leading-none shrink-0">←</button>
                <span className="font-semibold text-sm truncate">
                  {activeChannel.hasPassword ? "🔒 " : activeChannel.isGlobal ? "🌍 " : "# "}{activeChannel.name}
                </span>
                {online.length > 0 && (
                  <span className="text-xs text-white/70 shrink-0">· {online.length} online</span>
                )}
              </div>
            ) : (
              <span className="font-semibold text-sm">💬 Chat</span>
            )}
            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white text-lg leading-none ml-2 shrink-0">✕</button>
          </div>

          {/* Content */}
          {!activeChannel ? (
            /* Channel list */
            <div className="flex-1 overflow-y-auto">
              {channels.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No channels yet.</p>
              ) : (
                <div className="flex flex-col">
                  {globalChannels.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-4 pt-3 pb-1">Global</p>
                      {globalChannels.map((ch) => <ChannelRow key={ch.id} ch={ch} onClick={() => openChannel(ch)} />)}
                    </div>
                  )}
                  {Object.entries(bySpace).map(([spaceName, chs]) => (
                    <div key={spaceName}>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-4 pt-3 pb-1">👥 {spaceName}</p>
                      {chs.map((ch) => <ChannelRow key={ch.id} ch={ch} onClick={() => openChannel(ch)} />)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : needsPassword ? (
            /* Password gate */
            <div className="flex-1 flex flex-col items-center justify-center p-4 gap-3">
              <p className="text-2xl">🔒</p>
              <p className="text-sm font-semibold text-gray-700">{activeChannel.name}</p>
              <form onSubmit={joinWithPassword} className="w-full flex flex-col gap-2">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Channel password"
                  autoFocus
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 w-full"
                />
                {pwError && <p className="text-xs text-red-500">{pwError}</p>}
                <button type="submit" className="bg-accent text-white text-sm font-semibold py-2 rounded-full hover:bg-orange-600 transition-colors">
                  Join
                </button>
              </form>
            </div>
          ) : (
            /* Messages */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
                {nextCursor && (
                  <button onClick={loadMore} className="text-xs text-orange-500 hover:text-orange-600 text-center py-1">
                    Load older
                  </button>
                )}
                {loadingMsgs ? (
                  <p className="text-xs text-gray-400 text-center py-4">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">No messages yet. Say hi! 👋</p>
                ) : (
                  messages.map((msg, i) => {
                    const isOwn = msg.userId === session.user.id;
                    const sameSender = messages[i - 1]?.userId === msg.userId;
                    return (
                      <div key={msg.id} className={`flex gap-1.5 ${isOwn ? "flex-row-reverse" : ""}`}>
                        {!sameSender ? <Avatar name={msg.userName} image={msg.userImage} size={22} /> : <div className="w-[22px] shrink-0" />}
                        <div className={`flex flex-col gap-0.5 max-w-[80%] ${isOwn ? "items-end" : "items-start"}`}>
                          {!sameSender && (
                            <p className="text-[10px] text-gray-400 px-1">
                              {isOwn ? "You" : msg.userName} · {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                            </p>
                          )}
                          <div className={`rounded-2xl px-3 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${isOwn ? "bg-accent text-white rounded-tr-sm" : "bg-gray-100 text-gray-800 rounded-tl-sm"}`}>
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="px-3 py-2 border-t border-gray-100 shrink-0">
                <form onSubmit={send} className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Message…"
                    rows={1}
                    maxLength={2000}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 min-h-[32px] max-h-24"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || sending}
                    className="bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-orange-600 disabled:opacity-40 transition-colors shrink-0"
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toggle button */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-12 h-12 bg-accent hover:bg-orange-600 text-white rounded-full shadow-lg flex items-center justify-center text-xl transition-colors"
        >
          {open ? "✕" : "💬"}
        </button>
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 pointer-events-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </div>
    </div>
  );

  return createPortal(widget, document.body);
}

function ChannelRow({ ch, onClick }: { ch: Channel; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center justify-between gap-2"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-gray-800 truncate">
          {ch.hasPassword ? "🔒 " : "# "}{ch.name}
        </span>
        {ch.description && <span className="text-xs text-gray-400 truncate">{ch.description}</span>}
      </div>
      {ch._count.presence > 0 && (
        <span className="text-xs text-green-500 font-medium shrink-0">● {ch._count.presence}</span>
      )}
    </button>
  );
}
