"use client";

import { useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/shared/Toast";
import type { Comment } from "@prisma/client";

interface CommentThreadProps {
  postId: string;
  initialComments: Comment[];
  currentUserId: string;
  currentUserName: string;
}

function Avatar({ name, image }: { name: string; image?: string | null }) {
  if (image) {
    return (
      <div className="relative w-7 h-7 rounded-full overflow-hidden shrink-0">
        <Image src={image} alt={name} fill className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-600 shrink-0">
      {name[0]}
    </div>
  );
}

export function CommentThread({ postId, initialComments, currentUserId, currentUserName }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
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

  const saveEdit = async (id: string) => {
    if (!editBody.trim()) return;
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody.trim() }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setComments((prev) => prev.map((c) => c.id === id ? updated : c));
      setEditingId(null);
    } catch {
      showToast("Failed to edit comment", "error");
    }
  };

  const deleteComment = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    try {
      await fetch(`/api/comments/${id}`, { method: "DELETE" });
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      showToast("Failed to delete comment", "error");
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
          {comments.map((c) => {
            const isOwn = c.userId === currentUserId;
            return (
              <div key={c.id} className="flex gap-2">
                <Avatar name={c.authorName} image={c.authorImage} />
                <div className="bg-gray-50 rounded-xl px-3 py-2 flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-semibold text-gray-700 truncate">{c.authorName}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    {isOwn && editingId !== c.id && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { setEditingId(c.id); setEditBody(c.body); }}
                          className="text-[10px] text-gray-300 hover:text-blue-400 transition-colors"
                        >✏️</button>
                        <button
                          onClick={() => deleteComment(c.id)}
                          className="text-[10px] text-gray-300 hover:text-red-400 transition-colors"
                        >✕</button>
                      </div>
                    )}
                  </div>

                  {editingId === c.id ? (
                    <div className="mt-1 flex flex-col gap-1">
                      <input
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-200 w-full"
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                        <button onClick={() => saveEdit(c.id)} className="text-xs text-accent font-semibold hover:text-orange-600">Save</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-800 mt-0.5 break-words">{c.body}</p>
                  )}
                </div>
              </div>
            );
          })}

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
