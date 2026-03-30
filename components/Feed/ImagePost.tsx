"use client";

import { useState } from "react";
import Image from "next/image";

export function ImagePost({ url }: { url: string }) {
  const [lightbox, setLightbox] = useState(false);

  return (
    <>
      <button
        onClick={() => setLightbox(true)}
        className="block w-full rounded-xl overflow-hidden focus:outline-none"
      >
        <Image
          src={url}
          alt="Post image"
          width={800}
          height={600}
          className="w-full object-contain max-h-[480px] bg-gray-50"
          unoptimized
        />
      </button>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <Image
            src={url}
            alt="Full size"
            width={1200}
            height={900}
            className="max-w-full max-h-full object-contain rounded-lg"
            unoptimized
          />
          <button
            className="absolute top-4 right-4 text-white text-2xl font-bold"
            onClick={() => setLightbox(false)}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
