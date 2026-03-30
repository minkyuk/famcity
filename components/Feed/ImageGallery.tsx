"use client";

import { useState, useRef } from "react";
import Image from "next/image";

interface ImageGalleryProps {
  images: { url: string; order: number }[];
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const sorted = [...images].sort((a, b) => a.order - b.order);
  const count = sorted.length;

  // Touch tracking for swipe gestures
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current || lightbox === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;

    // Vertical swipe (up or down) — close
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 50) {
      setLightbox(null);
      return;
    }
    // Horizontal swipe — prev / next
    if (Math.abs(dx) > 50) {
      if (dx < 0 && lightbox < sorted.length - 1) setLightbox(lightbox + 1);
      if (dx > 0 && lightbox > 0) setLightbox(lightbox - 1);
    }
  };

  const gridClass =
    count === 1 ? "grid-cols-1" :
    count === 2 ? "grid-cols-2" :
    "grid-cols-2";

  return (
    <>
      <div className={`grid gap-1 rounded-xl overflow-hidden ${gridClass}`}>
        {sorted.map((img, i) => {
          const isOddThird = count === 3 && i === 2;
          return (
            <button
              key={i}
              onClick={() => setLightbox(i)}
              className={`relative overflow-hidden focus:outline-none ${isOddThird ? "col-span-2" : ""}`}
              style={{ aspectRatio: isOddThird ? "2/1" : count === 1 ? "16/9" : "1/1", maxHeight: count === 1 ? 360 : undefined }}
            >
              <Image
                src={img.url}
                alt={`Photo ${i + 1}`}
                fill
                sizes={count === 1 ? "100vw" : "(max-width: 768px) 50vw, 33vw"}
                className="object-cover hover:opacity-95 transition-opacity"
                unoptimized
              />
              {count > 4 && i === 3 && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xl font-bold">
                  +{count - 3}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {lightbox !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Prev arrow */}
          {lightbox > 0 && (
            <button
              className="absolute left-4 text-white text-3xl font-bold z-10 w-10 h-10 flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); }}
            >‹</button>
          )}

          <Image
            src={sorted[lightbox].url}
            alt=""
            width={1200}
            height={900}
            className="max-w-full max-h-full object-contain rounded-lg"
            unoptimized
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next arrow */}
          {lightbox < sorted.length - 1 && (
            <button
              className="absolute right-4 text-white text-3xl font-bold z-10 w-10 h-10 flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); }}
            >›</button>
          )}

          <button
            className="absolute top-4 right-4 text-white text-xl font-bold"
            onClick={() => setLightbox(null)}
          >✕</button>

          <div className="absolute bottom-4 text-white text-sm opacity-60">
            {lightbox + 1} / {sorted.length}
          </div>

          {/* Swipe hint — shown briefly */}
          <div className="absolute bottom-10 text-white/40 text-xs pointer-events-none">
            swipe ← → to navigate · swipe ↕ to close
          </div>
        </div>
      )}
    </>
  );
}
