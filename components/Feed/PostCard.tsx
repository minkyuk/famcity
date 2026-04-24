"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";

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
import Image from "next/image";
import { YoutubeEmbed } from "./YoutubeEmbed";
import { ImageGallery } from "./ImageGallery";
import { ImagePost } from "./ImagePost";
import { AudioPlayer } from "./AudioPlayer";
import { ReactionBar } from "./ReactionBar";
import { CommentThread } from "./CommentThread";
import { HashtagPills } from "./HashtagPills";
import { UserPopup } from "@/components/shared/UserPopup";
import { getAgentRank } from "@/lib/agents";
import type { Post, Reaction, Comment, PostMedia, PostHashtag, Hashtag } from "@prisma/client";

type PostWithRelations = Post & {
  reactions: Reaction[];
  comments: Comment[];
  media: PostMedia[];
  hashtags: (PostHashtag & { hashtag: Hashtag })[];
  space: { name: string } | null;
  _count: { reactions: number; comments: number };
  mutualSpace?: string | null;
};

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  TEXT: { label: "Text", color: "bg-gray-100 text-gray-500" },
  IMAGE: { label: "Photo", color: "bg-blue-100 text-blue-600" },
  YOUTUBE: { label: "Video", color: "bg-red-100 text-red-600" },
  AUDIO: { label: "Audio", color: "bg-purple-100 text-purple-600" },
  VIDEO: { label: "Video", color: "bg-orange-100 text-orange-600" },
  PDF: { label: "PDF", color: "bg-sky-100 text-sky-600" },
};

function pdfThumbnail(url: string): string {
  // Cloudinary: insert f_jpg,pg_1 transformation to render page 1 as JPEG
  return url.replace("/upload/", "/upload/f_jpg,pg_1/").replace(/\.pdf$/i, ".jpg");
}

function pdfDownloadUrl(url: string): string {
  return `/api/media/download?url=${encodeURIComponent(url)}`;
}

interface PostCardProps {
  post: PostWithRelations;
  currentUserId: string;
  currentUserName: string;
  isAdmin?: boolean;
  onDelete?: (id: string) => void;
  onUpdate?: (updated: Partial<Post>) => void;
}

function Avatar({ name, image }: { name: string; image?: string | null }) {
  if (image) {
    return (
      <div className="relative w-9 h-9 rounded-full overflow-hidden shrink-0">
        <Image src={image} alt={name} fill className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600 shrink-0">
      {name[0]}
    </div>
  );
}

function SummaryBlock({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg bg-sky-50 border border-sky-100 text-xs text-sky-800 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 font-medium hover:bg-sky-100 transition-colors"
      >
        <span>📚 Key points</span>
        <span className="text-sky-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="px-3 pb-2 pt-0.5 flex flex-col gap-0.5 list-none">
          {summary.split("\n").filter((l) => l.trim()).map((line, i) => (
            <li key={i} className="leading-relaxed">{line.replace(/^•\s*/, "• ")}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PostCard({ post, currentUserId, currentUserName, isAdmin, onDelete, onUpdate }: PostCardProps) {
  const badge = TYPE_BADGE[post.type];
  const isOwner = post.userId === currentUserId;
  const canModerate = isOwner || isAdmin;

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content ?? "");
  const [isPrivate, setIsPrivate] = useState(post.isPrivate);
  const [editSpaceId, setEditSpaceId] = useState<string>(post.spaceId ?? "");
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [localPost, setLocalPost] = useState(post);
  const [showPopup, setShowPopup] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  // Fetch spaces lazily when edit mode opens
  useEffect(() => {
    if (!editing || spaces.length > 0) return;
    fetch("/api/spaces")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSpaces(data.filter((s: { isSystem?: boolean }) => !s.isSystem));
      })
      .catch(() => {});
  }, [editing, spaces.length]);

  const handleDelete = async () => {
    if (!confirm("Delete this post?")) return;
    await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
    onDelete?.(post.id);
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: editContent,
        isPrivate,
        spaceId: editSpaceId || null,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      // Refetch space name if spaceId changed
      const newSpace = editSpaceId
        ? (spaces.find((s) => s.id === editSpaceId) ?? localPost.space)
        : null;
      setLocalPost((p) => ({
        ...p,
        content: updated.content,
        isPrivate: updated.isPrivate,
        spaceId: updated.spaceId,
        space: newSpace,
      }));
      onUpdate?.(updated);
    }
    setEditing(false);
    setSaving(false);
  };

  const handleShare = () => {
    const url = `${window.location.origin}${window.location.pathname}#post-${post.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleTranslate = async () => {
    if (translation) { setShowTranslation((s) => !s); return; }
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: localPost.content }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTranslation(data.translated);
      setShowTranslation(true);
    } catch {
      // silently fail
    } finally {
      setTranslating(false);
    }
  };

  const isKorean = (t: string) => (t.match(/[\uAC00-\uD7A3]/g) ?? []).length / t.replace(/\s/g, "").length > 0.3;

  const spaceName = localPost.space?.name ?? (localPost.spaceId ? null : "Global");

  return (
    <>
    <article id={`post-${post.id}`} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          ref={avatarRef}
          onClick={() => setShowPopup(true)}
          className="flex items-center gap-2 text-left"
        >
          <Avatar name={localPost.authorName} image={localPost.authorImage} />
          <div>
            <div className="flex items-center gap-1">
              <p className="text-sm font-semibold text-gray-800">{localPost.authorName}</p>
              {(() => {
                const rank = getAgentRank(localPost.authorName, localPost.authorImage, localPost.userId);
                if (rank === "knight") return <span title="Knight — roams all spaces" className="text-xs text-amber-500">♞</span>;
                if (rank === "squire") return <span title="Space Agent — confined to this space" className="text-xs text-sky-400">🏰</span>;
                return null;
              })()}
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-gray-400">
                {formatDistanceToNow(new Date(localPost.createdAt), { addSuffix: true })}
              </p>
              {spaceName && (
                <>
                  <span className="text-xs text-gray-300">·</span>
                  {localPost.spaceId ? (
                    <a
                      href={`/spaces/${localPost.spaceId}`}
                      className="text-xs text-gray-400 hover:text-orange-500 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      👥 {spaceName}
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400">🌍 Global</span>
                  )}
                </>
              )}
              {localPost.isPrivate && (
                <>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-yellow-600">🔒 Only me</span>
                </>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
            title="Copy link"
          >
            {copied ? "✓" : "🔗"}
          </button>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
            {badge.label}
          </span>
          {canModerate && (
            <div className="flex items-center gap-1">
              {isOwner && (
                <button
                  onClick={() => { setEditing(true); setEditContent(localPost.content ?? ""); setIsPrivate(localPost.isPrivate); setEditSpaceId(localPost.spaceId ?? ""); }}
                  className="text-xs text-gray-300 hover:text-blue-400 transition-colors"
                  title="Edit post"
                >
                  ✏️
                </button>
              )}
              <button onClick={handleDelete} className="text-xs text-gray-300 hover:text-red-400 transition-colors" title="Delete post">
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline edit */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          {/* Space selector */}
          <select
            value={editSpaceId}
            onChange={(e) => setEditSpaceId(e.target.value)}
            className="text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white"
          >
            <option value="">🌍 My network (no space)</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>👥 {s.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="accent-orange-500"
            />
            🔒 Only visible to me
          </label>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        localPost.content && (
          <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{linkify(localPost.content)}</p>
        )
      )}

      {localPost.summary && <SummaryBlock summary={localPost.summary} />}

      {localPost.content && localPost.content.length > 20 && (
        <div>
          <button
            onClick={handleTranslate}
            disabled={translating}
            className="text-[11px] text-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50 underline underline-offset-2"
          >
            {translating ? "번역 중…" : isKorean(localPost.content) ? "🌐 Translate to English" : "🌐 한국어로 번역"}
          </button>
          {showTranslation && translation && (
            <p className="text-sm text-gray-500 italic mt-1 leading-relaxed border-l-2 border-gray-100 pl-2">
              {translation}
            </p>
          )}
        </div>
      )}

      {localPost.hashtags.length > 0 && (
        <Suspense>
          <HashtagPills hashtags={localPost.hashtags} />
        </Suspense>
      )}

      {post.type === "IMAGE" && post.media.length > 1 && <ImageGallery images={post.media} />}
      {post.type === "IMAGE" && post.media.length === 1 && <ImagePost url={post.media[0].url} />}
      {post.type === "IMAGE" && post.media.length === 0 && post.mediaUrl && <ImagePost url={post.mediaUrl} />}
      {post.type === "YOUTUBE" && post.mediaUrl && <YoutubeEmbed url={post.mediaUrl} />}
      {post.type === "AUDIO" && post.mediaUrl && <AudioPlayer url={post.mediaUrl} />}
      {post.type === "VIDEO" && post.mediaUrl && (
        <video
          src={post.mediaUrl}
          controls
          className="w-full rounded-xl max-h-96 bg-black"
          preload="metadata"
        />
      )}
      {post.type === "PDF" && post.mediaUrl && (
        <div className="flex flex-col gap-2">
          <img
            src={pdfThumbnail(post.mediaUrl)}
            alt="PDF preview"
            className="w-full rounded-xl border border-gray-100"
          />
          <a
            href={pdfDownloadUrl(post.mediaUrl)}
            download
            className="flex items-center gap-2 text-sm text-orange-600 hover:text-orange-700 font-medium"
          >
            📄 Download PDF
          </a>
        </div>
      )}

      {post.mutualSpace && post.userId !== currentUserId && (
        <p className="text-[10px] text-gray-300 text-right">via 👥 {post.mutualSpace}</p>
      )}

      {(() => {
        const meta = post.metadata as { votes?: number; qualityGated?: boolean; deduplicated?: boolean } | null;
        if (!meta) return null;
        return (
          <div className="flex flex-wrap gap-1.5">
            {meta.votes != null && (
              <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">
                🗳️ {meta.votes} vote{meta.votes !== 1 ? "s" : ""}
              </span>
            )}
            {meta.qualityGated && (
              <span className="text-[10px] text-green-500 bg-green-50 border border-green-100 rounded-full px-2 py-0.5">
                ✓ quality-checked
              </span>
            )}
            {meta.deduplicated && (
              <span className="text-[10px] text-blue-400 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                ✓ deduplicated
              </span>
            )}
          </div>
        );
      })()}

      <ReactionBar postId={post.id} reactions={post.reactions} currentUserName={currentUserName} />
      <CommentThread postId={post.id} initialComments={post.comments} currentUserId={currentUserId} currentUserName={currentUserName} isAdmin={isAdmin} spaceId={post.spaceId} />
    </article>
    {showPopup && localPost.userId && (
      <UserPopup
        userId={localPost.userId}
        name={localPost.authorName}
        image={localPost.authorImage ?? null}
        anchorRef={avatarRef}
        onClose={() => setShowPopup(false)}
        currentUserId={currentUserId}
      />
    )}
    </>
  );
}
