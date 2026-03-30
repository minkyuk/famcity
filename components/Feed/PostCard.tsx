"use client";

import { Suspense } from "react";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import { YoutubeEmbed } from "./YoutubeEmbed";
import { ImageGallery } from "./ImageGallery";
import { ImagePost } from "./ImagePost";
import { AudioPlayer } from "./AudioPlayer";
import { ReactionBar } from "./ReactionBar";
import { CommentThread } from "./CommentThread";
import { HashtagPills } from "./HashtagPills";
import type { Post, Reaction, Comment, PostMedia, PostHashtag, Hashtag } from "@prisma/client";

type PostWithRelations = Post & {
  reactions: Reaction[];
  comments: Comment[];
  media: PostMedia[];
  hashtags: (PostHashtag & { hashtag: Hashtag })[];
  _count: { reactions: number; comments: number };
};

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  TEXT: { label: "Text", color: "bg-gray-100 text-gray-500" },
  IMAGE: { label: "Photo", color: "bg-blue-100 text-blue-600" },
  YOUTUBE: { label: "Video", color: "bg-red-100 text-red-600" },
  AUDIO: { label: "Audio", color: "bg-purple-100 text-purple-600" },
};

interface PostCardProps {
  post: PostWithRelations;
  currentUserId: string;
  currentUserName: string;
  onDelete?: (id: string) => void;
}

function Avatar({ name, image }: { name: string; image?: string | null }) {
  if (image) {
    return <Image src={image} alt={name} width={36} height={36} className="rounded-full" unoptimized />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600">
      {name[0]}
    </div>
  );
}

export function PostCard({ post, currentUserId, currentUserName, onDelete }: PostCardProps) {
  const badge = TYPE_BADGE[post.type];
  const isOwner = post.userId === currentUserId;

  const handleDelete = async () => {
    if (!confirm("Delete this post?")) return;
    await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
    onDelete?.(post.id);
  };

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar name={post.authorName} image={post.authorImage} />
          <div>
            <p className="text-sm font-semibold text-gray-800">{post.authorName}</p>
            <p className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
            {post.type === "IMAGE" && post.media.length > 1 ? `${post.media.length} Photos` : badge.label}
          </span>
          {isOwner && (
            <button onClick={handleDelete} className="text-xs text-gray-300 hover:text-red-400 transition-colors" title="Delete post">
              ✕
            </button>
          )}
        </div>
      </div>

      {post.content && (
        <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
      )}

      {post.hashtags.length > 0 && (
        <Suspense>
          <HashtagPills hashtags={post.hashtags} />
        </Suspense>
      )}

      {post.type === "IMAGE" && post.media.length > 1 && <ImageGallery images={post.media} />}
      {post.type === "IMAGE" && post.media.length === 1 && <ImagePost url={post.media[0].url} />}
      {post.type === "IMAGE" && post.media.length === 0 && post.mediaUrl && <ImagePost url={post.mediaUrl} />}
      {post.type === "YOUTUBE" && post.mediaUrl && <YoutubeEmbed url={post.mediaUrl} />}
      {post.type === "AUDIO" && post.mediaUrl && <AudioPlayer url={post.mediaUrl} />}

      <ReactionBar postId={post.id} reactions={post.reactions} currentUserName={currentUserName} />
      <CommentThread postId={post.id} initialComments={post.comments} currentUserName={currentUserName} />
    </article>
  );
}
