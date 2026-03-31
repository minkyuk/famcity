"use client";

import { Suspense, useState } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { ComposeBar } from "@/components/Compose/ComposeBar";

interface InlineComposeCardProps {
  defaultSpaceId?: string;
}

export function InlineComposeCard({ defaultSpaceId }: InlineComposeCardProps) {
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState(false);

  const image = session?.user?.image;
  const name = session?.user?.name ?? "You";

  if (!session) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      {!expanded ? (
        <div className="flex items-center gap-3">
          {image ? (
            <div className="relative w-9 h-9 rounded-full overflow-hidden shrink-0">
              <Image src={image} alt={name} fill className="object-cover" unoptimized />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600 shrink-0">
              {name[0]}
            </div>
          )}
          <button
            onClick={() => setExpanded(true)}
            className="flex-1 text-left bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full px-4 py-2.5 text-sm text-gray-400 transition-colors"
          >
            Share something with your family…
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(true)} className="p-2 text-gray-400 hover:text-blue-500 transition-colors" title="Photo">🖼</button>
            <button onClick={() => setExpanded(true)} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="YouTube">🎬</button>
            <button onClick={() => setExpanded(true)} className="p-2 text-gray-400 hover:text-purple-500 transition-colors" title="Audio">🎙</button>
          </div>
        </div>
      ) : (
        <Suspense>
          <ComposeBar
            inline
            defaultSpaceId={defaultSpaceId}
            onSuccess={() => setExpanded(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
