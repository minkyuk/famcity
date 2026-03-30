"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface UserPopupProps {
  userId: string;
  name: string;
  image: string | null;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  currentUserId: string;
}

interface UserData {
  id: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  email: string | null;
}

interface Pos {
  top: number;
  left: number;
}

export function UserPopup({
  userId,
  name,
  image,
  anchorRef,
  onClose,
  currentUserId,
}: UserPopupProps) {
  const router = useRouter();
  const popupRef = useRef<HTMLDivElement>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  // Compute position from anchor element
  useEffect(() => {
    const anchorEl = anchorRef.current;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPos({
        top: rect.bottom + 8,
        left: Math.min(rect.left, window.innerWidth - 256),
      });
    }
    setMounted(true);
  }, [anchorRef]);

  // Fetch user data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.user) {
          setUserData(data.user as UserData);
        }
      })
      .catch(() => {
        // ignore fetch errors — popup will just show basic info
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose, anchorRef]);

  const handleViewProfile = () => {
    onClose();
    router.push(`/profile/${userId}`);
  };

  const handleMessage = () => {
    onClose();
    router.push(`/profile/${userId}`);
  };

  if (!mounted) return null;

  const displayImage = userData?.image ?? image;
  const displayName = userData?.name ?? name;
  const bio = userData?.bio ?? null;
  const isSelf = userId === currentUserId;

  const popup = (
    <div
      ref={popupRef}
      style={{ top: pos.top, left: pos.left, width: 240 }}
      className="fixed z-[200] bg-white rounded-xl shadow-lg border border-gray-100 p-4 flex flex-col gap-3"
    >
      {/* Avatar + name */}
      <div className="flex items-center gap-3">
        {displayImage ? (
          <div className="relative w-10 h-10 rounded-full overflow-hidden shrink-0">
            <Image
              src={displayImage}
              alt={displayName ?? name}
              fill
              className="object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600 shrink-0">
            {(displayName ?? name)[0]}
          </div>
        )}
        <p className="text-sm font-bold text-gray-800 leading-tight">
          {displayName ?? name}
        </p>
      </div>

      {/* Bio */}
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        bio && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
            {bio}
          </p>
        )
      )}

      {/* Actions */}
      <div className="flex flex-col gap-1.5 pt-1">
        <button
          onClick={handleViewProfile}
          className="text-xs font-medium text-orange-600 hover:text-orange-700 text-left transition-colors"
        >
          View profile →
        </button>
        {!isSelf && (
          <button
            onClick={handleMessage}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            💬 Message
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}
