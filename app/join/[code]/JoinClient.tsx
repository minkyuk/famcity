"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

export function JoinClient({ code }: { code: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [message, setMessage] = useState("Joining…");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      signIn("google", { callbackUrl: `/join/${code}` });
      return;
    }

    fetch(`/api/join/${code}`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data.spaceId) {
          setMessage(`Joined "${data.name}"! Redirecting…`);
          setTimeout(() => router.push(`/spaces/${data.spaceId}`), 1000);
        } else {
          setMessage("Invalid or expired invite link.");
        }
      })
      .catch(() => setMessage("Something went wrong."));
  }, [session, status, code, router]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <span className="text-5xl">🏡</span>
      <p className="text-gray-600 text-sm font-medium">{message}</p>
    </div>
  );
}
