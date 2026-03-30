"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

interface DMUser {
  id: string;
  name: string | null;
  image: string | null;
}

interface Message {
  id: string;
  content: string;
  createdAt: string;
  fromUser: { id: string; name: string | null; image: string | null };
}

interface DMModalProps {
  me: { id: string; name: string | null; image: string | null };
  other: DMUser;
  onClose: () => void;
}

export function DMModal({ me, other, onClose }: DMModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchMessages = async () => {
    const res = await fetch(`/api/dm/${other.id}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data);
    }
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 4000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${other.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.trim() }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages((prev) => [...prev, msg]);
        setText("");
      }
    } finally {
      setSending(false);
    }
  };

  const fmt = (d: string) => {
    const date = new Date(d);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:w-[420px] sm:rounded-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[90vh] sm:max-h-[600px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="shrink-0">
            {other.image ? (
              <div className="relative w-9 h-9 rounded-full overflow-hidden">
                <Image src={other.image} alt={other.name ?? ""} fill className="object-cover" unoptimized />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600">
                {other.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{other.name ?? "Unknown"}</p>
            <p className="text-xs text-gray-400">Direct message</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0">×</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 min-h-0">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No messages yet. Say hi! 👋</p>
          )}
          {messages.map((msg) => {
            const isMine = msg.fromUser.id === me.id;
            return (
              <div key={msg.id} className={`flex gap-2 ${isMine ? "flex-row-reverse" : "flex-row"}`}>
                <div className="shrink-0 mt-1">
                  {msg.fromUser.image ? (
                    <div className="relative w-6 h-6 rounded-full overflow-hidden">
                      <Image src={msg.fromUser.image} alt={msg.fromUser.name ?? ""} fill className="object-cover" unoptimized />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">
                      {msg.fromUser.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                </div>
                <div className={`flex flex-col gap-0.5 max-w-[70%] ${isMine ? "items-end" : "items-start"}`}>
                  <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    isMine
                      ? "bg-orange-500 text-white rounded-tr-sm"
                      : "bg-gray-100 text-gray-800 rounded-tl-sm"
                  }`}>
                    {msg.content}
                  </div>
                  <p className="text-[10px] text-gray-400">{fmt(msg.createdAt)}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={send} className="flex gap-2 px-4 py-3 border-t border-gray-100 shrink-0">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message ${other.name ?? ""}…`}
            className="flex-1 min-w-0 text-sm border border-gray-200 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-orange-200"
            maxLength={2000}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="bg-orange-500 text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-orange-600 disabled:opacity-40 transition-colors shrink-0"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
