"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Sprite frames for a simple cat walk cycle using text/emoji art
// We use a CSS sprite sheet approach with a canvas-free pure CSS cat

const CAT_FRAMES = ["🐱", "🐈"];

export function WalkingCat() {
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ x: 80, y: -1 }); // y=-1 means bottom
  const [flipped, setFlipped] = useState(false);
  const [frame, setFrame] = useState(0);
  const velRef = useRef({ x: 1.2, y: 0 });
  const posRef = useRef({ x: 80, y: 0 });
  const rafRef = useRef<number>(0);
  const lastFrameTime = useRef(0);
  const frameInterval = 300; // ms between sprite frames

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;

    const CAT_SIZE = 40;
    posRef.current = { x: 80, y: window.innerHeight - CAT_SIZE - 8 };
    setPos(posRef.current);

    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - lastTime, 50); // cap at 50ms to avoid jumps
      lastTime = now;

      const vx = velRef.current.x;
      const vy = velRef.current.y;
      let nx = posRef.current.x + vx * (dt / 16);
      let ny = posRef.current.y + vy * (dt / 16);

      const maxX = window.innerWidth - CAT_SIZE;
      const maxY = window.innerHeight - CAT_SIZE - 8;

      // Bounce off walls
      let newVx = vx;
      let newVy = vy;

      if (nx <= 0) { nx = 0; newVx = Math.abs(vx); }
      if (nx >= maxX) { nx = maxX; newVx = -Math.abs(vx); }

      // Mostly stay near the bottom but occasionally wander up
      if (ny <= maxY * 0.3) { newVy = Math.abs(vy) * 0.5 + 0.3; }
      if (ny >= maxY) { ny = maxY; newVy = -Math.abs(vy) * 0.3; }

      // Randomly nudge direction occasionally
      if (Math.random() < 0.002) newVy = (Math.random() - 0.7) * 1.5;
      if (Math.random() < 0.001) newVx = -newVx;

      // Gravity pull to bottom
      newVy += 0.02;
      if (ny >= maxY - 2) newVy = Math.min(newVy, 0);

      velRef.current = { x: newVx, y: newVy };
      posRef.current = { x: nx, y: ny };
      setPos({ x: nx, y: ny });
      setFlipped(newVx < 0);

      // Sprite frame
      if (now - lastFrameTime.current > frameInterval) {
        setFrame((f) => (f + 1) % CAT_FRAMES.length);
        lastFrameTime.current = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        pointerEvents: "none",
        userSelect: "none",
        fontSize: 32,
        lineHeight: 1,
        transform: flipped ? "scaleX(-1)" : "scaleX(1)",
        transition: "transform 0.1s",
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.15))",
      }}
    >
      {CAT_FRAMES[frame]}
    </div>,
    document.body
  );
}
