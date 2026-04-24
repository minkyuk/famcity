"use client";

import { useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/shared/Toast";
import type { Comment } from "@prisma/client";
import { getAgentRank } from "@/lib/agents";

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

function TranslateButton({ text }: { text: string }) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [show, setShow] = useState(false);

  if (text.length <= 15) return null;

  const handleTranslate = async () => {
    if (translation) { setShow((s) => !s); return; }
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTranslation(data.translated);
      setShow(true);
    } catch {
      // silently fail
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleTranslate}
        disabled={translating}
        className="text-[10px] text-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50 underline underline-offset-2"
      >
        {translating ? "…" : isKorean(text) ? "🌐 Translate" : "🌐 번역"}
      </button>
      {show && translation && (
        <p className="text-xs text-gray-500 italic mt-1 leading-relaxed border-l-2 border-gray-100 pl-2">
          {translation}
        </p>
      )}
    </div>
  );
}

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
  onReply: (parentId: string, parentAuthor: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  editingId: string | null;
  editBody: string;
  setEditBody: (v: string) => void;
  saveEdit: (id: string) => void;
  cancelEdit: () => void;
}

function CommentRow({
  c, depth, replies, allComments, currentUserId, isAdmin,
  onReply, onDelete, onEdit, editingId, editBody, setEditBody, saveEdit, cancelEdit,
}: CommentRowProps) {
  const isOwn = c.userId === currentUserId;
  const canDelete = isOwn || isAdmin;
  const [likeCount, setLikeCount] = useState(c.likes ?? 0);
  const [liked, setLiked] = useState(false);

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
    <div className={depth > 0 ? "ml-3 border-l border-gray-100 pl-2" : ""}>
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
              <input
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-200 w-full"
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
              <p className="text-sm text-gray-800 mt-0.5 break-words whitespace-pre-wrap">{linkify(c.body)}</p>
              {c.summary && <CommentSummary summary={c.summary} />}
              <div className="flex items-center gap-3 mt-1">
                <TranslateButton text={c.body} />
                <button
                  onClick={() => onReply(c.id, c.authorName)}
                  className="text-[10px] text-gray-400 hover:text-orange-500 transition-colors"
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
              onReply={onReply}
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
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);
  const { showToast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          ...(replyTo ? { parentId: replyTo.id } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      const comment = await res.json();
      setComments((prev) => [...prev, comment]);
      setBody("");
      setReplyTo(null);
      // Fire-and-forget: trigger agents to respond immediately
      if (spaceId) fetch(`/api/spaces/${spaceId}/trigger`, { method: "POST" }).catch(() => {});
      fetch("/api/agents/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerPostId: postId }),
      }).catch(() => {});
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

  const handleReply = (parentId: string, parentAuthor: string) => {
    setReplyTo({ id: parentId, author: parentAuthor });
    setOpen(true);
    // Focus the input shortly after render
    setTimeout(() => {
      document.getElementById(`reply-input-${postId}`)?.focus();
    }, 50);
  };

  const topLevel = comments.filter((c) => !c.parentId);

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
          {topLevel.map((c) => (
            <CommentRow
              key={c.id}
              c={c}
              depth={0}
              replies={comments.filter((r) => r.parentId === c.id)}
              allComments={comments}
              currentUserId={currentUserId}
              isAdmin={!!isAdmin}
              onReply={handleReply}
              onDelete={deleteComment}
              onEdit={(id, body) => { setEditingId(id); setEditBody(body); }}
              editingId={editingId}
              editBody={editBody}
              setEditBody={setEditBody}
              saveEdit={saveEdit}
              cancelEdit={() => setEditingId(null)}
            />
          ))}

          {replyTo && (
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs text-gray-500">↩ Replying to <span className="font-semibold text-gray-700">{replyTo.author}</span></span>
              <button onClick={() => setReplyTo(null)} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}

          <form onSubmit={submit} className="flex gap-2 mt-1">
            <input
              id={`reply-input-${postId}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={replyTo ? `Reply to ${replyTo.author}…` : "Write a comment…"}
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
