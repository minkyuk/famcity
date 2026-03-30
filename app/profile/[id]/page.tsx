"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { PostCard } from "@/components/Feed/PostCard";
import { DMModal } from "@/components/shared/DMModal";

type User = { id: string; name: string | null; image: string | null; bio: string | null; email: string | null };

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [bio, setBio] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dmOpen, setDmOpen] = useState(false);

  const isOwn = session?.user?.id === id;

  useEffect(() => {
    fetch(`/api/users/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user);
        setBio(d.user?.bio ?? "");
        setPosts(d.posts ?? []);
        setLoading(false);
      });
  }, [id]);

  const saveBio = async () => {
    setSaving(true);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio }),
    });
    const updated = await res.json();
    setUser((u) => u ? { ...u, bio: updated.bio } : u);
    setEditing(false);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <div className="py-24 text-center text-gray-400">User not found.</div>;
  }

  return (
    <>
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      {/* Profile header */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center gap-4">
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name ?? ""}
            width={80}
            height={80}
            className="rounded-full border-4 border-orange-100"
            unoptimized
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center text-2xl font-bold text-orange-600">
            {user.name?.[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">{user.name}</h1>
          {isOwn && (
            <p className="text-xs text-gray-400">{user.email}</p>
          )}
        </div>

        {!isOwn && session?.user && (
          <button
            onClick={() => setDmOpen(true)}
            className="bg-orange-500 text-white text-sm font-semibold px-5 py-2 rounded-full hover:bg-orange-600 transition-colors"
          >
            💬 Message
          </button>
        )}

        {/* Bio */}
        {editing ? (
          <div className="w-full flex flex-col gap-2">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Write something about yourself…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setEditing(false); setBio(user.bio ?? ""); }}
                className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1"
              >
                Cancel
              </button>
              <button
                onClick={saveBio}
                disabled={saving}
                className="bg-accent text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full text-center">
            {user.bio ? (
              <p className="text-sm text-gray-600 leading-relaxed">{user.bio}</p>
            ) : (
              isOwn && <p className="text-sm text-gray-400 italic">No bio yet.</p>
            )}
            {isOwn && (
              <button
                onClick={() => setEditing(true)}
                className="mt-2 text-xs text-orange-500 hover:text-orange-600 font-medium"
              >
                {user.bio ? "Edit bio" : "+ Add bio"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Posts */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-3">
          {isOwn ? "Your posts" : `Posts by ${user.name}`}
        </h2>
        {posts.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No posts yet.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={session?.user?.id ?? ""}
                currentUserName={session?.user?.name ?? ""}
                onDelete={(deletedId) => setPosts((p) => p.filter((x) => x.id !== deletedId))}
              />
            ))}
          </div>
        )}
      </div>
    </div>

    {dmOpen && !isOwn && session?.user && (
      <DMModal
        me={{ id: session.user.id, name: session.user.name ?? null, image: session.user.image ?? null }}
        other={{ id: user.id, name: user.name, image: user.image }}
        onClose={() => setDmOpen(false)}
      />
    )}
    </>
  );
}
