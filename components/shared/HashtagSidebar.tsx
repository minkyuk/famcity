"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface HashtagEntry {
  id: string;
  tag: string;
  _count: { posts: number };
}

interface HashtagSidebarProps {
  spaceId?: string;
}

export function HashtagSidebar({ spaceId }: HashtagSidebarProps) {
  const [hashtags, setHashtags] = useState<HashtagEntry[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTag = searchParams.get("tag");

  useEffect(() => {
    const params = new URLSearchParams();
    if (spaceId) params.set("spaceId", spaceId);
    fetch(`/api/hashtags?${params}`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setHashtags(data))
      .catch(() => {});
  }, [spaceId]);

  if (hashtags.length === 0) return null;

  const select = (tag: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (activeTag === tag) {
      params.delete("tag");
    } else {
      params.set("tag", tag);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <aside className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-1">
        Hashtags
      </p>
      {hashtags.map((h) => (
        <button
          key={h.id}
          onClick={() => select(h.tag)}
          className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
            activeTag === h.tag
              ? "bg-orange-100 text-accent font-semibold"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>#{h.tag}</span>
          <span className="text-xs text-gray-400">{h._count.posts}</span>
        </button>
      ))}
      {activeTag && (
        <button
          onClick={() => select(activeTag)}
          className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 mt-1"
        >
          ✕ Clear filter
        </button>
      )}
    </aside>
  );
}
