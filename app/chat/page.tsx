"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Channel = {
  id: string;
  name: string;
  description: string | null;
  isGlobal: boolean;
  hasPassword: boolean;
  _count: { messages: number; presence: number };
};

export default function ChatPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPass, setNewPass] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchChannels = () =>
    fetch("/api/chat/channels")
      .then((r) => r.json())
      .then((d) => { setChannels(d); setLoading(false); });

  useEffect(() => { fetchChannels(); }, []);

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    await fetch("/api/chat/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined, password: newPass || undefined }),
    });
    setNewName(""); setNewDesc(""); setNewPass("");
    setShowCreate(false);
    setCreating(false);
    fetchChannels();
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">💬 Chat</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-accent text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-orange-600 transition-colors"
        >
          + New channel
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-gray-900">New channel</h2>
            <form onSubmit={createChannel} className="flex flex-col gap-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Channel name"
                maxLength={50}
                required
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                maxLength={200}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              <input
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Password (leave blank for public)"
                minLength={4}
                maxLength={100}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-accent text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : channels.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No channels yet. Create one!</div>
      ) : (
        <div className="flex flex-col gap-3">
          {channels.map((ch) => (
            <Link
              key={ch.id}
              href={`/chat/${ch.id}`}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:border-orange-200 transition-colors group"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 group-hover:text-accent transition-colors">
                    {ch.isGlobal ? "🌍 " : ch.hasPassword ? "🔒 " : "# "}
                    {ch.name}
                  </span>
                  {ch.hasPassword && (
                    <span className="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">Private</span>
                  )}
                  {ch.isGlobal && (
                    <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">Global</span>
                  )}
                </div>
                {ch.description && (
                  <p className="text-xs text-gray-400">{ch.description}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 text-xs text-gray-400 shrink-0 ml-4">
                <span>{ch._count.messages} msgs</span>
                {ch._count.presence > 0 && (
                  <span className="text-green-500 font-medium">● {ch._count.presence} online</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
