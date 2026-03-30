"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  if (status === "loading") return <div className="w-8 h-8 rounded-full bg-gray-100 animate-pulse" />;

  if (!session) {
    return (
      <button onClick={() => signIn("google")} className="text-sm font-semibold text-accent hover:underline">
        Sign in
      </button>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="focus:outline-none">
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt={session.user.name ?? ""}
            width={32}
            height={32}
            className="rounded-full border-2 border-orange-200"
            unoptimized
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-orange-200 flex items-center justify-center text-sm font-bold text-orange-700">
            {session.user.name?.[0]?.toUpperCase() ?? "?"}
          </div>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 bg-white rounded-xl shadow-lg border border-gray-100 w-48 py-1">
            <div className="px-4 py-2 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-800 truncate">{session.user.name}</p>
              <p className="text-xs text-gray-400 truncate">{session.user.email}</p>
            </div>
            <Link
              href={`/profile/${session.user.id}`}
              onClick={() => setOpen(false)}
              className="block w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              View profile
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
