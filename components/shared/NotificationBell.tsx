"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";

const STORAGE_KEY = "famcity_last_seen";

type NotifItem =
  | { kind: "post"; id: string; postId: string; authorName: string; authorImage: string | null; content: string | null; spaceName: string | null; createdAt: string }
  | { kind: "comment"; id: string; postId: string; authorName: string; authorImage: string | null; body: string; postContent: string | null; spaceName: string | null; createdAt: string };

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
  const [items, setItems] = useState<NotifItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 60, right: 16 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = async () => {
    if (open) { setOpen(false); return; }

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }

    setOpen(true);
    setLoading(true);
    setUnread(0);
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());

    try {
      const res = await fetch(`/api/posts/unread?recent=1`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = (postId: string) => {
    setOpen(false);
    router.push(`/posts/${postId}`);
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
          style={{ position: "fixed", top: dropdownPos.top, right: dropdownPos.right, zIndex: 9999 }}
          className="bg-white rounded-xl shadow-xl border border-gray-100 w-80 max-h-[440px] flex flex-col"
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
            <p className="text-sm font-semibold text-gray-800">Notifications</p>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No recent activity</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.kind + item.id}
                  onClick={() => handleItemClick(item.postId)}
                  className="w-full flex gap-3 px-4 py-3 hover:bg-orange-50 border-b border-gray-50 transition-colors text-left"
                >
                  {/* Avatar */}
                  <div className="shrink-0">
                    {item.authorImage ? (
                      <div className="relative w-8 h-8 rounded-full overflow-hidden">
                        <Image src={item.authorImage} alt={item.authorName} fill className="object-cover" unoptimized />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-orange-200 flex items-center justify-center text-xs font-bold text-orange-700">
                        {item.authorName[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700">
                      {item.authorName}
                      {item.spaceName && (
                        <span className="font-normal text-gray-400"> in {item.spaceName}</span>
                      )}
                    </p>

                    {item.kind === "comment" ? (
                      <>
                        <p className="text-xs text-orange-600 mt-0.5">💬 commented on your post</p>
                        <p className="text-xs text-gray-500 line-clamp-2 mt-0.5 italic">"{item.body}"</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                        {item.content ?? "Shared a photo or file"}
                      </p>
                    )}

                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(item.createdAt)}</p>
                  </div>

                  {/* Arrow hint */}
                  <span className="text-gray-300 text-xs self-center shrink-0">→</span>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
