"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

const STORAGE_KEY = "famcity_last_seen";

interface NotifPost {
  id: string;
  content: string | null;
  createdAt: string;
  user: { name: string | null; image: string | null } | null;
  space: { name: string } | null;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [posts, setPosts] = useState<NotifPost[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 60, right: 16 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Badge count on mount
  useEffect(() => {
    let lastSeen = localStorage.getItem(STORAGE_KEY);
    if (!lastSeen) {
      lastSeen = new Date(0).toISOString();
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    }
    fetch(`/api/posts/unread?since=${encodeURIComponent(lastSeen)}&recent=1`)
      .then((r) => r.json())
      .then((d) => setUnread(d.count ?? 0))
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = async () => {
    if (open) { setOpen(false); return; }

    // Capture button position before state changes
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }

    setOpen(true);
    setLoading(true);
    setUnread(0);
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    try {
      const since = new Date(0).toISOString();
      const res = await fetch(`/api/posts/unread?since=${encodeURIComponent(since)}&recent=1`);
      const data = await res.json();
      setPosts(data.posts ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition-colors"
        title="Notifications"
      >
        <span className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {mounted && open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: dropdownPos.top,
            right: dropdownPos.right,
            zIndex: 9999,
          }}
          className="bg-white rounded-xl shadow-xl border border-gray-100 w-80 max-h-[420px] flex flex-col"
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
            <p className="text-sm font-semibold text-gray-800">Recent activity</p>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No recent posts</p>
            ) : (
              posts.map((post) => (
                <div
                  key={post.id}
                  className="flex gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-50 transition-colors cursor-default"
                >
                  <div className="shrink-0">
                    {post.user?.image ? (
                      <div className="relative w-8 h-8 rounded-full overflow-hidden">
                        <Image src={post.user.image} alt={post.user.name ?? ""} fill className="object-cover" unoptimized />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-orange-200 flex items-center justify-center text-xs font-bold text-orange-700">
                        {post.user?.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700">
                      {post.user?.name ?? "Someone"}
                      {post.space && <span className="font-normal text-gray-400"> in {post.space.name}</span>}
                    </p>
                    <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                      {post.content ?? "Shared a photo or audio"}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(post.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
