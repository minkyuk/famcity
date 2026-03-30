"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface HashtagPillsProps {
  hashtags: { hashtag: { tag: string } }[];
}

export function HashtagPills({ hashtags }: HashtagPillsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTag = searchParams.get("tag");

  if (hashtags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {hashtags.map(({ hashtag }) => (
        <button
          key={hashtag.tag}
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            if (activeTag === hashtag.tag) {
              params.delete("tag");
            } else {
              params.set("tag", hashtag.tag);
            }
            router.push(`?${params.toString()}`);
          }}
          className="text-xs text-accent font-medium hover:underline"
        >
          #{hashtag.tag}
        </button>
      ))}
    </div>
  );
}
