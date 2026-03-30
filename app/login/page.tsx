"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <div className="text-6xl mb-4">🏡</div>
        <h1 className="text-2xl font-bold text-gray-800">Welcome to FamCity</h1>
        <p className="text-gray-500 text-sm mt-2">Sign in to see and share with your family</p>
      </div>

      {error === "AccessDenied" && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl max-w-sm text-center">
          Your email isn't on the family list. Ask the admin to add you.
        </div>
      )}

      <button
        onClick={() => signIn("google", { callbackUrl: "/" })}
        className="flex items-center gap-3 bg-white border border-gray-200 shadow-sm px-6 py-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
          <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.76-2.7.76-2.07 0-3.83-1.4-4.46-3.28H1.86v2.07A8 8 0 0 0 8.98 17z"/>
          <path fill="#FBBC05" d="M4.52 10.53c-.16-.48-.25-.99-.25-1.53s.09-1.05.25-1.53V5.4H1.86A8 8 0 0 0 .98 9c0 1.29.31 2.51.88 3.6l2.66-2.07z"/>
          <path fill="#EA4335" d="M8.98 3.72c1.16 0 2.2.4 3.02 1.19l2.26-2.26A8 8 0 0 0 .98 9l2.54 1.97C4.15 5.12 6.26 3.72 8.98 3.72z"/>
        </svg>
        Continue with Google
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
