"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PostCard } from "@/components/Feed/PostCard";
import type { Post, Reaction, Comment } from "@prisma/client";

type PostWithRelations = Post & {
  reactions: Reaction[];
  comments: Comment[];
  _count: { reactions: number; comments: number };
};

interface FeedProps {
  initialPosts: PostWithRelations[];
  initialNextCursor: string | null;
}

export function Feed({ initialPosts, initialNextCursor }: FeedProps) {
  const [posts, setPosts] = useState<PostWithRelations[]>(initialPosts);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newBanner, setNewBanner] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (session === null) router.push("/login");
  }, [session, router]);

  // SSE real-time feed
  useEffect(() => {
    const since = initialPosts[0]?.createdAt
      ? new Date(initialPosts[0].createdAt).toISOString()
      : new Date().toISOString();

    const es = new EventSource(`/api/sse?since=${encodeURIComponent(since)}`);

    es.onmessage = (e) => {
      const incoming: PostWithRelations[] = JSON.parse(e.data);
      if (incoming.length === 0) return;

      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const novel = incoming.filter((p) => !existingIds.has(p.id));
        if (novel.length === 0) return prev;
        setNewBanner((n) => n + novel.length);
        return [...novel.reverse(), ...prev];
      });
    };

    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/posts?cursor=${nextCursor}`);
      const data = await res.json();
      setPosts((prev) => [...prev, ...data.posts]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

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

  const handleDelete = (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  if (!session) return null;

  if (posts.length === 0) {
    return (
      <div className="text-center py-24 flex flex-col items-center gap-3">
        <span className="text-5xl">🏡</span>
        <p className="text-gray-500 text-sm">No posts yet — be the first!</p>
        <a
          href="/compose"
          className="bg-accent text-white text-sm font-semibold px-5 py-2 rounded-full hover:bg-orange-600 transition-colors"
        >
          Create a post
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {newBanner > 0 && (
        <button
          onClick={() => {
            setNewBanner(0);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
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
          onDelete={handleDelete}
        />
      ))}
      <div ref={sentinelRef} />
      {loadingMore && (
        <p className="text-center text-sm text-gray-400 py-4">Loading more…</p>
      )}
      {!nextCursor && posts.length > 0 && (
        <p className="text-center text-xs text-gray-300 py-4">You're all caught up 🎉</p>
      )}
    </div>
  );
}
