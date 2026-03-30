"use client";

import { useState } from "react";
import { REACTION_EMOJIS } from "@/lib/constants";
import { useToast } from "@/components/shared/Toast";
import type { Reaction } from "@prisma/client";

interface ReactionBarProps {
  postId: string;
  reactions: Reaction[];
  currentUserName: string;
}

export function ReactionBar({ postId, reactions, currentUserName }: ReactionBarProps) {
  const [localReactions, setLocalReactions] = useState<Reaction[]>(reactions);
  const { showToast } = useToast();

  const countFor = (emoji: string) =>
    localReactions.filter((r) => r.emoji === emoji).length;

  const hasReacted = (emoji: string) =>
    localReactions.some((r) => r.emoji === emoji && r.name === currentUserName);

  const toggle = async (emoji: string) => {
    const optimistic = hasReacted(emoji);
    if (optimistic) {
      setLocalReactions((prev) =>
        prev.filter((r) => !(r.emoji === emoji && r.name === currentUserName))
      );
    } else {
      const fake = {
        id: `temp-${Date.now()}`,
        postId,
        emoji,
        name: currentUserName,
        createdAt: new Date(),
      } as Reaction;
      setLocalReactions((prev) => [...prev, fake]);
    }

    try {
      const res = await fetch(`/api/posts/${postId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setLocalReactions(reactions);
      showToast("Failed to react", "error");
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {REACTION_EMOJIS.map((emoji) => {
        const count = countFor(emoji);
        const reacted = hasReacted(emoji);
        return (
          <button
            key={emoji}
            onClick={() => toggle(emoji)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border transition-all ${
              reacted
                ? "bg-orange-100 border-orange-300 text-orange-700 font-semibold"
                : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
            }`}
          >
            <span>{emoji}</span>
            {count > 0 && <span className="text-xs">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
