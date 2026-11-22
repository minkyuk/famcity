"use client";

import { useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/shared/Toast";
import type { Comment } from "@prisma/client";
import { getAgentRank } from "@/lib/agents";
import { useTranslate } from "@/components/shared/useTranslate";
import { ReplyComposer } from "./ReplyComposer";
import { rowsFor } from "./textareaRows";

function linkify(text: string): React.ReactNode {
  const re = /https?:\/\/[^\s)>\]]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    parts.push(<a key={m.index} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">{url}</a>);
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 1 ? <>{parts}</> : text;
}

const isKorean = (t: string) => (t.match(/[\uAC00-\uD7A3]/g) ?? []).length / Math.max(t.replace(/\s/g, "").length, 1) > 0.3;

interface CommentThreadProps {
  postId: string;
  initialComments: Comment[];
  currentUserId: string;
  currentUserName: string;
  isAdmin?: boolean;
  spaceId?: string | null;
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

function CommentSummary({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md bg-sky-50 border border-sky-100 text-[11px] text-sky-800 mt-1 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-2 py-1 font-medium hover:bg-sky-100 transition-colors"
      >
        <span>📚 Key points</span>
        <span className="text-sky-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="px-2 pb-1.5 pt-0.5 flex flex-col gap-0.5 list-none">
          {summary.split("\n").filter((l) => l.trim()).map((line, i) => (
            <li key={i} className="leading-relaxed">{line.replace(/^•\s*/, "• ")}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CommentRowProps {
  c: Comment;
  depth: number;
  replies: Comment[];
  allComments: Comment[];
  currentUserId: string;
  isAdmin: boolean;
  likedIds: Set<string>;
  /** The comment whose reply box is open (at most one in the thread). */
  replyingToId: string | null;
  onReply: (commentId: string) => void;
  onCancelReply: () => void;
  onSubmitReply: (parentId: string, text: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  editingId: string | null;
  editBody: string;
  setEditBody: (v: string) => void;
  saveEdit: (id: string) => void;
  cancelEdit: () => void;
}

function CommentRow({
  c, depth, replies, allComments, currentUserId, isAdmin, likedIds,
  replyingToId, onReply, onCancelReply, onSubmitReply, onDelete, onEdit, editingId, editBody, setEditBody, saveEdit, cancelEdit,
}: CommentRowProps) {
  const isOwn = c.userId === currentUserId;
  const canDelete = isOwn || isAdmin;
  const [likeCount, setLikeCount] = useState(c.likes ?? 0);
  const [liked, setLiked] = useState(() => likedIds.has(c.id));
  const translate = useTranslate(c.body);

  const handleLike = async () => {
    try {
      const res = await fetch(`/api/comments/${c.id}/like`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json() as { liked: boolean; likes: number };
      setLiked(data.liked);
      setLikeCount(data.likes);
    } catch { /* ignore */ }
  };

  return (
    <div id={`comment-${c.id}`} className={depth === 1 ? "ml-3 border-l border-gray-100 pl-2" : depth > 1 ? "border-l border-gray-100 pl-2" : ""}>
      <div className="flex gap-2">
        <Avatar name={c.authorName} image={c.authorImage} />
        <div className="bg-gray-50 rounded-xl px-3 py-2 flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-semibold text-gray-700 truncate">{c.authorName}</span>
              {(() => {
                const rank = getAgentRank(c.authorName, c.authorImage, c.userId);
                if (rank === "knight") return <span title="Knight — roams all spaces" className="text-[10px] text-amber-500 shrink-0">♞</span>;
                if (rank === "squire") return <span title="Space Agent — confined to this space" className="text-[10px] text-sky-400 shrink-0">🏰</span>;
                return null;
              })()}
              <span className="text-xs text-gray-400 shrink-0">
                · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
              </span>
            </div>
            {canDelete && editingId !== c.id && (
              <div className="flex items-center gap-1 shrink-0">
                {isOwn && (
                  <button
                    onClick={() => onEdit(c.id, c.body)}
                    className="text-[10px] text-gray-300 hover:text-blue-400 transition-colors"
                  >✏️</button>
                )}
                <button
                  onClick={() => onDelete(c.id)}
                  className="text-[10px] text-gray-300 hover:text-red-400 transition-colors"
                >✕</button>
              </div>
            )}
          </div>

          {editingId === c.id ? (
            <div className="mt-1 flex flex-col gap-1">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={rowsFor(editBody, 1, 8)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-200 w-full resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={cancelEdit} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                <button onClick={() => saveEdit(c.id)} className="text-xs text-accent font-semibold hover:text-orange-600">Save</button>
              </div>
            </div>
          ) : (
            <>
              {depth > 0 && c.parentId && (() => {
                const parent = allComments.find((x) => x.id === c.parentId);
                return parent ? (
                  <p className="text-[10px] text-gray-400 mb-0.5">↩ {parent.authorName}</p>
                ) : null;
              })()}
              <div className="overflow-x-auto">
                <p className="text-sm text-gray-800 mt-0.5 break-words whitespace-pre-wrap min-w-0">{linkify(c.body)}</p>
              </div>
              {c.summary && <CommentSummary summary={c.summary} />}
              <div className="flex items-center gap-3 mt-1">
                {c.body.length > 15 && (
                  <button
                    onClick={translate.toggle}
                    disabled={translate.translating}
                    className="text-[10px] text-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50 underline underline-offset-2"
                  >
                    {translate.translating ? "…" : isKorean(c.body) ? "🌐 Translate" : "🌐 번역"}
                  </button>
                )}
                <button
                  onClick={() => onReply(c.id)}
                  className={`text-[10px] transition-colors ${replyingToId === c.id ? "text-orange-500" : "text-gray-400 hover:text-orange-500"}`}
                >
                  ↩ Reply
                </button>
                <button
                  onClick={handleLike}
                  className={`text-[10px] flex items-center gap-0.5 transition-colors ${liked ? "text-red-400" : "text-gray-300 hover:text-red-400"}`}
                >
                  {liked ? "♥" : "♡"}{likeCount > 0 ? ` ${likeCount}` : ""}
                </button>
              </div>
              {translate.error && <p className="text-[10px] text-red-500 mt-1">{translate.error}</p>}
              {translate.show && translate.translation && (
                <p className="text-xs text-gray-500 italic mt-1 leading-relaxed border-l-2 border-gray-200 pl-2 whitespace-pre-wrap">
                  {translate.translation}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Nested replies */}
      {replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {replies.map((r) => (
            <CommentRow
              key={r.id}
              c={r}
              depth={Math.min(depth + 1, 2)}
              replies={allComments.filter((x) => x.parentId === r.id)}
              allComments={allComments}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              likedIds={likedIds}
              replyingToId={replyingToId}
              onReply={onReply}
              onCancelReply={onCancelReply}
              onSubmitReply={onSubmitReply}
              onDelete={onDelete}
              onEdit={onEdit}
              editingId={editingId}
              editBody={editBody}
              setEditBody={setEditBody}
              saveEdit={saveEdit}
              cancelEdit={cancelEdit}
            />
          ))}
        </div>
      )}

      {/* The reply box opens here, under this comment and its replies — not at the top of the thread */}
      {replyingToId === c.id && (
        <div className={`mt-2 border-l border-gray-100 pl-2 ${depth === 0 ? "ml-3" : ""}`}>
          <ReplyComposer author={c.authorName} onSubmit={(text) => onSubmitReply(c.id, text)} onCancel={onCancelReply} />
        </div>
      )}
    </div>
  );
}

export function CommentThread({ postId, initialComments, currentUserId, currentUserName, isAdmin, spaceId }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  const fetchLiked = async () => {
    try {
      const res = await fetch(`/api/comments/liked?postId=${postId}`);
      if (!res.ok) return;
      const data = await res.json() as { likedIds: string[] };
      setLikedIds(new Set(data.likedIds));
    } catch { /* ignore */ }
  };

  /** Saves a comment (a reply when `parentId` is given) and wakes the agents. True when saved. */
  const sendComment = async (text: string, parentId?: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, ...(parentId ? { parentId } : {}) }),
      });
      if (!res.ok) throw new Error();
      const comment: Comment = await res.json();
      setComments((prev) => [...prev, comment]);
      if (!open) { setOpen(true); fetchLiked(); }
      // The list scrolls inside its own box — bring the new comment into view once it has rendered.
      setTimeout(() => {
        document.getElementById(`comment-${comment.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 80);
      // Fire-and-forget: an agent answers this comment, under it (and a space's own agents may join in)
      if (spaceId) fetch(`/api/spaces/${spaceId}/trigger`, { method: "POST" }).catch(() => {});
      fetch("/api/agents/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerPostId: postId, triggerCommentId: comment.id }),
      }).catch(() => {});
      return true;
    } catch {
      showToast("Failed to post comment", "error");
      return false;
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    if (await sendComment(body.trim())) setBody("");
    setSubmitting(false);
  };

  const submitReply = async (parentId: string, text: string): Promise<boolean> => {
    const ok = await sendComment(text, parentId);
    if (ok) setReplyingToId(null);
    return ok;
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

  // Reply opens a box under that comment; pressing Reply again closes it.
  const handleReply = (commentId: string) => setReplyingToId((current) => (current === commentId ? null : commentId));

  const topLevel = comments.filter((c) => !c.parentId);

  return (
    <div className="mt-2 min-w-0 flex flex-col gap-2">
      {/* New comments: the composer sits directly under the post. Replies open under the comment itself. */}
      <form onSubmit={submit} className="flex items-end gap-2">
        {/* Enter adds a new line; only the Post button (or Ctrl/⌘+Enter) sends */}
        <textarea
          id={`reply-input-${postId}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          rows={rowsFor(body, 1, 6)}
          maxLength={1000}
          placeholder="Write a comment…"
          className="flex-1 min-w-0 text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-orange-200"
        />
        <button
          type="submit"
          disabled={submitting || !body.trim()}
          className="shrink-0 text-sm bg-accent text-white rounded-xl px-4 py-2 disabled:opacity-40 hover:bg-orange-600 transition-colors"
        >
          Post
        </button>
      </form>

      {comments.length > 0 && (
        <button
          onClick={() => { const next = !open; setOpen(next); if (next) fetchLiked(); }}
          className="self-start text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          {open ? "Hide comments" : `View ${comments.length} comment${comments.length !== 1 ? "s" : ""}`}
        </button>
      )}

      {open && comments.length > 0 && (
        // Bounded height: a long thread scrolls inside this box instead of stretching the feed
        <div className="flex flex-col gap-2 max-h-[28rem] overflow-y-auto pr-1">
          {topLevel.map((c) => (
            <CommentRow
              key={c.id}
              c={c}
              depth={0}
              replies={comments.filter((r) => r.parentId === c.id)}
              allComments={comments}
              currentUserId={currentUserId}
              isAdmin={!!isAdmin}
              likedIds={likedIds}
              replyingToId={replyingToId}
              onReply={handleReply}
              onCancelReply={() => setReplyingToId(null)}
              onSubmitReply={submitReply}
              onDelete={deleteComment}
              onEdit={(id, body) => { setEditingId(id); setEditBody(body); }}
              editingId={editingId}
              editBody={editBody}
              setEditBody={setEditBody}
              saveEdit={saveEdit}
              cancelEdit={() => setEditingId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
