"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

type OnlineUser = { userId: string; name: string; image: string | null };

export function OnlineWidget() {
  const [online, setOnline] = useState<OnlineUser[]>([]);

  useEffect(() => {
    const ping = () =>
      fetch("/api/chat/online", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null);

    const fetchOnline = () =>
      fetch("/api/chat/online")
        .then((r) => r.json())
        .then((d) => Array.isArray(d) && setOnline(d))
        .catch(() => {});

    ping().then(fetchOnline);

    const pingInterval = setInterval(() => ping().then(fetchOnline), 30_000);

    const handleUnload = () => fetch("/api/chat/online", { method: "DELETE", keepalive: true });
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(pingInterval);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  if (online.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-1">
        Online now
      </p>
      {online.map((u) => (
        <Link
          key={u.userId}
          href={`/profile/${u.userId}`}
          className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <div className="relative shrink-0">
            {u.image ? (
              <Image src={u.image} alt={u.name} width={22} height={22} className="rounded-full" unoptimized />
            ) : (
              <div className="w-[22px] h-[22px] rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-600">
                {u.name[0]?.toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 border border-white rounded-full" />
          </div>
          <span className="text-sm text-gray-600 truncate">{u.name}</span>
        </Link>
      ))}
    </div>
  );
}
