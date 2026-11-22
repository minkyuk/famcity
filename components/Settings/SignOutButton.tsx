"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-full border border-red-100 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
    >
      로그아웃 · Sign out
    </button>
  );
}
