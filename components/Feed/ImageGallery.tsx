"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";

interface ImageGalleryProps {
  images: { url: string; order: number }[];
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const sorted = [...images].sort((a, b) => a.order - b.order);
  const count = sorted.length;

  // Direct DOM refs — no state during drag, zero re-renders, buttery smooth
  const overlayRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Stable refs so event handlers always see fresh values without re-registering
  const lightboxRef = useRef<number | null>(null);
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;

  const touchRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    axis: "x" | "y" | null;
  } | null>(null);

  const close = useCallback(() => {
    lightboxRef.current = null;
    setLightbox(null);
  }, []);

  // Reset strip to center panel whenever the shown index changes
  useEffect(() => {
    lightboxRef.current = lightbox;
    const strip = stripRef.current;
    if (!strip) return;
    strip.style.transition = "none";
    strip.style.transform = `translateX(${-window.innerWidth}px) translateY(0)`;

    const overlay = overlayRef.current;
    if (overlay) overlay.style.backgroundColor = "rgba(0,0,0,0.95)";
  }, [lightbox]);

  // Attach non-passive touch listeners so we can e.preventDefault()
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || lightbox === null) return;

    const EASE = "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)";

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touchRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        lastT: Date.now(),
        axis: null,
      };
      const strip = stripRef.current;
      if (strip) strip.style.transition = "none";
    };

    const onMove = (e: TouchEvent) => {
      const tc = touchRef.current;
      const strip = stripRef.current;
      const idx = lightboxRef.current;
      if (!tc || !strip || idx === null) return;

      e.preventDefault(); // prevents page scroll while inside lightbox

      const t = e.touches[0];
      const dx = t.clientX - tc.startX;
      const dy = t.clientY - tc.startY;
      const W = window.innerWidth;

      // Determine axis once: y needs to be >1.8× more vertical to count
      if (!tc.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        tc.axis = Math.abs(dy) > Math.abs(dx) * 1.8 ? "y" : "x";
      }

      tc.lastX = t.clientX;
      tc.lastY = t.clientY;
      tc.lastT = Date.now();

      if (tc.axis === "x") {
        const imgs = sortedRef.current;
        const atStart = idx === 0 && dx > 0;
        const atEnd = idx === imgs.length - 1 && dx < 0;
        // Rubber-band: sqrt damping at edges
        const rubber = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.55) * 14;
        const effectiveDx = atStart || atEnd ? rubber(dx) : dx;
        strip.style.transform = `translateX(${-W + effectiveDx}px) translateY(0)`;
      } else if (tc.axis === "y") {
        // Image flies with finger, background fades
        strip.style.transform = `translateX(${-W}px) translateY(${dy}px)`;
        const overlay = overlayRef.current;
        if (overlay) {
          const opacity = Math.max(0.05, 0.95 * (1 - Math.abs(dy) / (window.innerHeight * 0.6)));
          overlay.style.backgroundColor = `rgba(0,0,0,${opacity})`;
        }
      }
    };

    const onEnd = (e: TouchEvent) => {
      const tc = touchRef.current;
      const strip = stripRef.current;
      const idx = lightboxRef.current;
      if (!tc || !strip || idx === null) return;

      const t = e.changedTouches[0];
      const dx = t.clientX - tc.startX;
      const dy = t.clientY - tc.startY;
      const dt = Math.max(16, Date.now() - tc.lastT);
      const vx = (t.clientX - tc.lastX) / dt; // px/ms
      const vy = (t.clientY - tc.lastY) / dt;
      const axis = tc.axis;
      touchRef.current = null;

      const W = window.innerWidth;
      const H = window.innerHeight;
      const overlay = overlayRef.current;
      const imgs = sortedRef.current;

      if (axis === "y") {
        // Hard swipe required: 40% screen height OR fast flick
        if (Math.abs(dy) > H * 0.4 || Math.abs(vy) > 0.7) {
          const dir = dy >= 0 ? 1 : -1;
          strip.style.transition = EASE;
          strip.style.transform = `translateX(${-W}px) translateY(${dir * H * 1.4}px)`;
          if (overlay) {
            overlay.style.transition = "background-color 0.3s ease";
            overlay.style.backgroundColor = "rgba(0,0,0,0)";
          }
          setTimeout(() => {
            if (overlay) { overlay.style.transition = ""; }
            close();
          }, 300);
        } else {
          // Spring back
          strip.style.transition = EASE;
          strip.style.transform = `translateX(${-W}px) translateY(0)`;
          if (overlay) {
            overlay.style.transition = "background-color 0.3s ease";
            overlay.style.backgroundColor = "rgba(0,0,0,0.95)";
            setTimeout(() => { if (overlay) overlay.style.transition = ""; }, 320);
          }
        }
      } else if (axis === "x") {
        const goNext = (dx < -W * 0.22 || vx < -0.35) && idx < imgs.length - 1;
        const goPrev = (dx > W * 0.22 || vx > 0.35) && idx > 0;

        if (goNext) {
          strip.style.transition = EASE;
          strip.style.transform = `translateX(${-W * 2}px) translateY(0)`;
          setTimeout(() => setLightbox(idx + 1), 280);
        } else if (goPrev) {
          strip.style.transition = EASE;
          strip.style.transform = `translateX(0) translateY(0)`;
          setTimeout(() => setLightbox(idx - 1), 280);
        } else {
          // Spring back
          strip.style.transition = EASE;
          strip.style.transform = `translateX(${-W}px) translateY(0)`;
        }
      } else {
        // No clear axis — spring to center
        strip.style.transition = "transform 0.2s ease";
        strip.style.transform = `translateX(${-W}px) translateY(0)`;
      }
    };

    overlay.addEventListener("touchstart", onStart, { passive: true });
    overlay.addEventListener("touchmove", onMove, { passive: false });
    overlay.addEventListener("touchend", onEnd, { passive: true });

    return () => {
      overlay.removeEventListener("touchstart", onStart);
      overlay.removeEventListener("touchmove", onMove);
      overlay.removeEventListener("touchend", onEnd);
    };
  }, [lightbox, close]);

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
              style={{
                aspectRatio: isOddThird ? "2/1" : count === 1 ? "16/9" : "1/1",
                maxHeight: count === 1 ? 360 : undefined,
              }}
            >
              <Image
                src={img.url}
                alt={`Photo ${i + 1}`}
                fill
                sizes={count === 1 ? "100vw" : "(max-width: 768px) 50vw, 33vw"}
                className={`${count === 1 ? "object-contain bg-gray-50" : "object-cover"} hover:opacity-95 transition-opacity`}
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
          ref={overlayRef}
          className="fixed inset-0 z-50 overflow-hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.95)" }}
          onClick={(e) => {
            if (e.target === overlayRef.current) setLightbox(null);
          }}
        >
          {/*
            Strip: [prev | current | next], each 100vw.
            Base position: translateX(-windowWidth) shows the center panel.
            Touch handlers move this directly via DOM, no state re-renders.
          */}
          <div
            ref={stripRef}
            className="flex h-full items-center will-change-transform"
            style={{
              width: "300vw",
              transform: "translateX(-100vw) translateY(0)",
            }}
          >
            {/* Prev */}
            <div className="w-screen h-full flex items-center justify-center p-6">
              {lightbox > 0 && (
                <Image
                  src={sorted[lightbox - 1].url}
                  alt=""
                  width={1200}
                  height={900}
                  className="max-w-full max-h-full object-contain rounded-lg"
                  unoptimized
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>

            {/* Current */}
            <div className="w-screen h-full flex items-center justify-center p-4">
              <Image
                src={sorted[lightbox].url}
                alt=""
                width={1200}
                height={900}
                className="max-w-full max-h-full object-contain rounded-lg"
                unoptimized
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Next */}
            <div className="w-screen h-full flex items-center justify-center p-6">
              {lightbox < sorted.length - 1 && (
                <Image
                  src={sorted[lightbox + 1].url}
                  alt=""
                  width={1200}
                  height={900}
                  className="max-w-full max-h-full object-contain rounded-lg"
                  unoptimized
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          </div>

          {/* Desktop arrows */}
          {lightbox > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-3xl z-10 w-10 h-10 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); }}
            >
              ‹
            </button>
          )}
          {lightbox < sorted.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-3xl z-10 w-10 h-10 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); }}
            >
              ›
            </button>
          )}

          <button
            className="absolute top-4 right-4 text-white text-xl z-10 opacity-60 hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
          >
            ✕
          </button>

          {sorted.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm opacity-50 z-10 pointer-events-none">
              {lightbox + 1} / {sorted.length}
            </div>
          )}
        </div>
      )}
    </>
  );
}
