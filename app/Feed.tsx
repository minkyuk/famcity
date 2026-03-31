"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { PostCard } from "@/components/Feed/PostCard";
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

interface FeedProps {
  initialPosts: PostWithRelations[];
  initialNextCursor: string | null;
  spaceId?: string;
  isAdmin?: boolean;
}

export function Feed({ initialPosts, initialNextCursor, spaceId, isAdmin }: FeedProps) {
  const [posts, setPosts] = useState<PostWithRelations[]>(initialPosts);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newBanner, setNewBanner] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTag = searchParams.get("tag");

  useEffect(() => {
    if (session === null) router.push("/login");
  }, [session, router]);

  // Re-fetch when tag filter changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (spaceId) params.set("spaceId", spaceId);
    if (activeTag) params.set("hashtag", activeTag);

    fetch(`/api/posts?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPosts(data.posts ?? []);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(() => {});
  }, [activeTag, spaceId]);

  // SSE real-time (only for unfiltered feed)
  useEffect(() => {
    if (activeTag) return; // don't stream when filtering
    const since = initialPosts[0]?.createdAt
      ? new Date(initialPosts[0].createdAt).toISOString()
      : new Date().toISOString();

    const params = new URLSearchParams({ since });
    if (spaceId) params.set("spaceId", spaceId);

    const es = new EventSource(`/api/sse?${params}`);
    es.onmessage = (e) => {
      const incoming: PostWithRelations[] = JSON.parse(e.data);
      if (!incoming.length) return;
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const novel = incoming.filter((p) => !existingIds.has(p.id));
        if (!novel.length) return prev;
        setNewBanner((n) => n + novel.length);
        return [...novel.reverse(), ...prev];
      });
    };
    return () => es.close();
  }, [spaceId, activeTag]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor: nextCursor });
      if (spaceId) params.set("spaceId", spaceId);
      if (activeTag) params.set("hashtag", activeTag);
      const res = await fetch(`/api/posts?${params}`);
      const data = await res.json();
      setPosts((prev) => [...prev, ...data.posts]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, spaceId, activeTag]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (!session) return null;

  if (posts.length === 0) {
    return (
      <div className="text-center py-24 flex flex-col items-center gap-3">
        <span className="text-5xl">{activeTag ? "🔍" : "🏡"}</span>
        <p className="text-gray-500 text-sm">
          {activeTag ? `No posts tagged #${activeTag}` : "No posts yet — be the first!"}
        </p>
        {!activeTag && (
          <a href="/compose" className="bg-accent text-white text-sm font-semibold px-5 py-2 rounded-full hover:bg-orange-600 transition-colors">
            Create a post
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {activeTag && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Showing <span className="font-semibold text-accent">#{activeTag}</span></span>
          <button
            onClick={() => { const p = new URLSearchParams(searchParams.toString()); p.delete("tag"); router.push(`?${p}`); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >✕ Clear</button>
        </div>
      )}

      {newBanner > 0 && !activeTag && (
        <button
          onClick={() => { setNewBanner(0); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="sticky top-16 z-30 mx-auto bg-accent text-white text-sm font-semibold px-5 py-2 rounded-full shadow-lg hover:bg-orange-600 transition-colors"
        >
          ↑ {newBanner} new {newBanner === 1 ? "post" : "posts"}
        </button>
      )}

      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          currentUserId={session.user.id}
          currentUserName={session.user.name ?? ""}
          isAdmin={isAdmin}
          onDelete={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
        />
      ))}
      <div ref={sentinelRef} />
      {loadingMore && <p className="text-center text-sm text-gray-400 py-4">Loading more…</p>}
      {!nextCursor && posts.length > 0 && (
        <p className="text-center text-xs text-gray-300 py-4">You're all caught up 🎉</p>
      )}
    </div>
  );
}
