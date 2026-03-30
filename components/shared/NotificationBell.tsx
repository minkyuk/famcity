"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "famcity_last_seen";

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (!lastSeen) {
      // First visit — mark now as seen, no badge
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      setReady(true);
      return;
    }

    fetch(`/api/posts/unread?since=${encodeURIComponent(lastSeen)}`)
      .then((r) => r.json())
      .then((data) => setUnread(data.count ?? 0))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const markRead = () => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setUnread(0);
  };

  if (!ready) return null;

  return (
    <button
      onClick={markRead}
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
  );
}
