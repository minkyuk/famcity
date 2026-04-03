"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

type Role = "user" | "assistant";
type Message = { role: Role; content: string; streaming?: boolean };
type Conversation = { id: string; title: string; model: string; updatedAt: string };

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku", cost: 1, note: "Fast · 1cr" },
  { id: "claude-sonnet-4-6",         label: "Sonnet", cost: 2, note: "Balanced · 2cr" },
  { id: "claude-opus-4-6",           label: "Opus",   cost: 5, note: "Best · 5cr" },
] as const;

type ModelId = (typeof MODELS)[number]["id"];

export default function AnalyzePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ModelId>("claude-sonnet-4-6");
  const [loading, setLoading] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeChatIdRef = useRef<string | null>(null);

  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetch("/api/credits").then((r) => r.json()).then((d) => setCredits(d.credits ?? null));
    }
  }, [session, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadConversations = useCallback(() => {
    fetch("/api/ai-chats").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setConversations(data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (session) loadConversations();
  }, [session, loadConversations]);

  const openConversation = async (conv: Conversation) => {
    const res = await fetch(`/api/ai-chats/${conv.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages.map((m: { role: Role; content: string }) => ({ role: m.role, content: m.content })));
    setActiveChatId(conv.id);
    setModel(conv.model as ModelId);
    setError(null);
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setActiveChatId(null);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await fetch(`/api/ai-chats/${id}`, { method: "DELETE" });
    if (activeChatId === id) newChat();
    setConversations((prev) => prev.filter((c) => c.id !== id));
  };

  const saveMessages = useCallback(async (userMsg: string, assistantMsg: string, usedModel: ModelId, existingId: string | null) => {
    if (existingId) {
      await fetch(`/api/ai-chats/${existingId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: userMsg }, { role: "assistant", content: assistantMsg }], model: usedModel }),
      });
      loadConversations();
    } else {
      const title = userMsg.slice(0, 80).trim();
      const res = await fetch("/api/ai-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, model: usedModel, messages: [{ role: "user", content: userMsg }, { role: "assistant", content: assistantMsg }] }),
      });
      if (res.ok) {
        const created = await res.json();
        setActiveChatId(created.id);
        loadConversations();
      }
    }
  }, [loadConversations]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setLoading(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: newMessages.map(({ role, content }) => ({ role, content })),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Something went wrong");
        setMessages(newMessages);
        setLoading(false);
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let assistantText = "";

      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          assistantText += chunk;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + chunk };
            return next;
          });
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, streaming: false };
        return next;
      });

      // Save turn to DB (fire-and-forget)
      if (assistantText) {
        saveMessages(text, assistantText, model, activeChatIdRef.current).catch(() => {});
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const stop = () => { abortRef.current?.abort(); setLoading(false); };

  if (status === "loading" || !session) return null;

  const currentModel = MODELS.find((m) => m.id === model)!;

  return (
    <div className="flex" style={{ height: "calc(100vh - 56px)" }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-52 shrink-0 border-r border-gray-100 flex flex-col bg-gray-50">
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chats</span>
            <button
              onClick={newChat}
              className="text-xs text-gray-400 hover:text-orange-500 transition-colors font-medium"
              title="New chat"
            >
              + New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-2">No saved chats yet</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => openConversation(conv)}
                  className={`w-full text-left px-3 py-2 group flex items-start justify-between gap-1 transition-colors ${
                    activeChatId === conv.id ? "bg-orange-50 text-orange-700" : "hover:bg-gray-100 text-gray-700"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate leading-snug">{conv.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: true })}
                    </p>
                  </div>
                  <span
                    onClick={(e) => deleteConversation(e, conv.id)}
                    className="text-gray-300 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 cursor-pointer"
                    title="Delete"
                  >
                    ✕
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="text-gray-400 hover:text-gray-600 text-xs mr-1 transition-colors"
              title="Toggle sidebar"
            >
              ☰
            </button>
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  model === m.id ? "bg-accent text-white" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {m.label}
                <span className={`ml-1 font-normal ${model === m.id ? "text-orange-100" : "text-gray-400"}`}>
                  {m.note}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {credits !== null && <span className="text-xs text-gray-400">{credits} cr</span>}
            {messages.length > 0 && (
              <button onClick={newChat} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <p className="text-3xl">🤖</p>
              <p className="text-base font-semibold text-gray-700">AI Analysis</p>
              <p className="text-sm text-gray-400 max-w-sm">
                Ask anything — {currentModel.label} is ready. Each message costs {currentModel.cost} credit{currentModel.cost > 1 ? "s" : ""}.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  msg.role === "user"
                    ? "bg-accent text-white rounded-tr-sm"
                    : "bg-gray-100 text-gray-800 rounded-tl-sm"
                }`}
              >
                {msg.content || (msg.streaming ? <span className="opacity-40 animate-pulse">thinking…</span> : "")}
              </div>
            </div>
          ))}

          {error && (
            <div className="flex justify-center">
              <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-gray-100 shrink-0">
          <div className="flex gap-2 items-end max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${currentModel.label}…`}
              rows={1}
              maxLength={20000}
              disabled={loading}
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 min-h-[42px] max-h-48 disabled:opacity-50"
              style={{ lineHeight: "1.5" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 192) + "px";
              }}
            />
            {loading ? (
              <button onClick={stop} className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold px-4 py-2.5 rounded-2xl transition-colors shrink-0">
                Stop
              </button>
            ) : (
              <button onClick={send} disabled={!input.trim()} className="bg-accent hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2.5 rounded-2xl transition-colors disabled:opacity-40 shrink-0">
                Send
              </button>
            )}
          </div>
          <p className="text-center text-[10px] text-gray-300 mt-1.5">
            Enter to send · Shift+Enter for new line · {currentModel.cost} cr per message
          </p>
        </div>
      </div>
    </div>
  );
}
