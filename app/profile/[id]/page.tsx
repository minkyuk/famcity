"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { PostCard } from "@/components/Feed/PostCard";
import { DMModal } from "@/components/shared/DMModal";
import { useToast } from "@/components/shared/Toast";

type User = { id: string; name: string | null; image: string | null; bio: string | null; email: string | null };

async function uploadToCloudinary(file: File): Promise<string> {
  const signRes = await fetch("/api/media/sign");
  const { signature, timestamp, apiKey, cloudName } = await signRes.json();

  const form = new FormData();
  form.append("file", file);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("api_key", apiKey);
  form.append("folder", "famcity");

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!data.secure_url) throw new Error("Upload failed");
  return data.secure_url;
}

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, update: updateSession } = useSession();
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dmOpen, setDmOpen] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editImage, setEditImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isOwn = session?.user?.id === id;
  const isAdmin = !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  const [credits, setCredits] = useState<number | null>(null);
  const [grantAmount, setGrantAmount] = useState("100");
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    fetch(`/api/users/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user);
        setEditName(d.user?.name ?? "");
        setEditBio(d.user?.bio ?? "");
        setEditImage(d.user?.image ?? null);
        setPosts(d.posts ?? []);
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (!session?.user) return;
    if (!isOwn && !isAdmin) return;
    fetch(`/api/credits?userId=${id}`)
      .then((r) => r.json())
      .then((d) => { if (typeof d.credits === "number") setCredits(d.credits); })
      .catch(() => {});
  }, [id, session, isOwn, isAdmin]);

  const handleGrant = async () => {
    const amount = parseInt(grantAmount, 10);
    if (!amount || amount < 1) return;
    setGranting(true);
    try {
      const res = await fetch("/api/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, amount }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCredits(data.credits);
      window.dispatchEvent(new CustomEvent("credits-changed"));
      showToast(`Granted ${amount} credits`);
    } catch {
      showToast("Failed to grant credits", "error");
    } finally {
      setGranting(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToCloudinary(file);
      setEditImage(url);
    } catch {
      showToast("Image upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          bio: editBio,
          image: editImage ?? undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setUser((u) => u ? { ...u, ...updated } : u);
      // Refresh NextAuth session so header updates immediately
      await updateSession({ name: updated.name, image: updated.image });
      setEditing(false);
      showToast("Profile updated!");
    } catch {
      showToast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditName(user?.name ?? "");
    setEditBio(user?.bio ?? "");
    setEditImage(user?.image ?? null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>;
  }
  if (!user) {
    return <div className="py-24 text-center text-gray-400">User not found.</div>;
  }

  const displayImage = editing ? editImage : user.image;
  const displayName = editing ? editName : user.name;

  return (
    <>
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      {/* Profile header */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center gap-4">

        {/* Avatar */}
        <div className="relative">
          {displayImage ? (
            <Image
              src={displayImage}
              alt={displayName ?? ""}
              width={80}
              height={80}
              className="rounded-full border-4 border-orange-100 object-cover"
              unoptimized
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center text-2xl font-bold text-orange-600">
              {(displayName ?? "?")[0]?.toUpperCase()}
            </div>
          )}
          {editing && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-accent text-white rounded-full flex items-center justify-center text-xs shadow-md hover:bg-orange-600 disabled:opacity-50 transition-colors"
              title="Change photo"
            >
              {uploading ? "…" : "📷"}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        </div>

        {/* Name / bio */}
        {editing ? (
          <div className="w-full flex flex-col gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Display name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                placeholder="Your name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Bio</label>
              <textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Write something about yourself…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={cancelEdit} className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1">
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={saving || uploading}
                className="bg-accent text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center w-full">
            <h1 className="text-xl font-bold text-gray-900">{user.name}</h1>
            {isOwn && <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>}
            {credits !== null && (isOwn || isAdmin) && (
              <p className="text-xs text-orange-500 font-medium mt-1">⚡ {credits} credits</p>
            )}
            {user.bio ? (
              <p className="text-sm text-gray-600 leading-relaxed mt-2">{user.bio}</p>
            ) : (
              isOwn && <p className="text-sm text-gray-400 italic mt-2">No bio yet.</p>
            )}
            {isOwn && (
              <button
                onClick={() => setEditing(true)}
                className="mt-3 text-xs text-orange-500 hover:text-orange-600 font-medium border border-orange-200 rounded-full px-3 py-1 transition-colors"
              >
                ✏️ Edit profile
              </button>
            )}
            {!isOwn && session?.user && (
              <button
                onClick={() => setDmOpen(true)}
                className="mt-3 bg-orange-500 text-white text-sm font-semibold px-5 py-2 rounded-full hover:bg-orange-600 transition-colors"
              >
                💬 Message
              </button>
            )}
            {isAdmin && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
                <button
                  onClick={handleGrant}
                  disabled={granting}
                  className="text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {granting ? "…" : "Grant credits"}
                </button>
              </div>
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
