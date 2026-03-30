"use client";

import { useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/shared/Toast";
import type { Comment } from "@prisma/client";

interface CommentThreadProps {
  postId: string;
  initialComments: Comment[];
  currentUserName: string;
}

function Avatar({ name, image }: { name: string; image?: string | null }) {
  if (image) {
    return (
      <Image src={image} alt={name} width={28} height={28} className="rounded-full shrink-0" unoptimized />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-600 shrink-0">
      {name[0]}
    </div>
  );
}

export function CommentThread({ postId, initialComments, currentUserName }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!res.ok) throw new Error();
      const comment = await res.json();
      setComments((prev) => [...prev, comment]);
      setBody("");
    } catch {
      showToast("Failed to post comment", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        {open ? "Hide" : `${comments.length} comment${comments.length !== 1 ? "s" : ""}`}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-2">
              <Avatar name={c.authorName} image={c.authorImage} />
              <div className="bg-gray-50 rounded-xl px-3 py-2 flex-1">
                <span className="text-xs font-semibold text-gray-700">{c.authorName} </span>
                <span className="text-xs text-gray-400">
                  · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                </span>
                <p className="text-sm text-gray-800 mt-0.5">{c.body}</p>
              </div>
            </div>
          ))}

          <form onSubmit={submit} className="flex gap-2 mt-1">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a comment…"
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="text-sm bg-accent text-white rounded-xl px-4 py-2 disabled:opacity-40 hover:bg-orange-600 transition-colors"
            >
              Post
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
