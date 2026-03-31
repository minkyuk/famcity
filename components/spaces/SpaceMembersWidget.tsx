"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type Member = { userId: string; name: string; image: string | null };

export function SpaceMembersWidget({
  spaceId,
  members,
}: {
  spaceId: string;
  members: Member[];
}) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ping = () =>
      fetch("/api/chat/online", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });

    const fetchOnline = () =>
      fetch(`/api/chat/online?spaceId=${spaceId}`)
        .then((r) => r.json())
        .then((d) => Array.isArray(d) && setOnlineIds(new Set(d.map((u: Member) => u.userId))))
        .catch(() => {});

    ping().then(fetchOnline);
    const interval = setInterval(() => ping().then(fetchOnline), 30_000);

    const handleUnload = () =>
      fetch("/api/chat/online", { method: "DELETE", keepalive: true });
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [spaceId]);

  if (members.length === 0) return null;

  const onlineCount = members.filter((m) => onlineIds.has(m.userId)).length;
  // Sort: online first, then alphabetical
  const sorted = [...members].sort((a, b) => {
    const aOnline = onlineIds.has(a.userId) ? 0 : 1;
    const bOnline = onlineIds.has(b.userId) ? 0 : 1;
    return aOnline - bOnline || a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-1">
        Members
        {onlineCount > 0 && (
          <span className="ml-1.5 normal-case font-normal text-green-500">
            · {onlineCount} online
          </span>
        )}
      </p>
      {sorted.map((m) => {
        const isOnline = onlineIds.has(m.userId);
        return (
          <Link
            key={m.userId}
            href={`/profile/${m.userId}`}
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="relative shrink-0">
              {m.image ? (
                <Image
                  src={m.image}
                  alt={m.name}
                  width={22}
                  height={22}
                  className="rounded-full"
                  unoptimized
                />
              ) : (
                <div className="w-[22px] h-[22px] rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-600">
                  {m.name[0]?.toUpperCase()}
                </div>
              )}
              {isOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 border border-white rounded-full" />
              )}
            </div>
            <span className={`text-sm truncate ${isOnline ? "text-gray-800 font-medium" : "text-gray-400"}`}>
              {m.name}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
