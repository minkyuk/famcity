"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CAT_W = 88;
const CAT_H = 58;
const PUDDLE_W = 88;
const PUDDLE_H = 58;

// ─── Orange cat SVG ──────────────────────────────────────────────────────────

function CatSVG({ speed }: { speed: number }) {
  const dur = Math.max(0.3, 0.7 - speed * 0.05) + "s";
  return (
    <svg width={CAT_W} height={CAT_H} viewBox="0 0 88 58" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        .cb{animation:bob ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:center}
        .lfl{animation:lA ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .lfr{animation:lB ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .lbl{animation:lB ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .lbr{animation:lA ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .tail{animation:tailSway 0.9s ease-in-out infinite;transform-box:fill-box;transform-origin:90% 40%}
        .eyeL{animation:blinkL 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
        .eyeR{animation:blinkR 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
        @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
        @keyframes lA{0%,100%{transform:rotate(-28deg) translateY(1px)}50%{transform:rotate(22deg) translateY(-1px)}}
        @keyframes lB{0%,100%{transform:rotate(22deg) translateY(-1px)}50%{transform:rotate(-28deg) translateY(1px)}}
        @keyframes tailSway{0%,100%{transform:rotate(-18deg)}50%{transform:rotate(22deg)}}
        @keyframes blinkL{0%,85%,100%{transform:scaleY(1)}88%,96%{transform:scaleY(0.08)}}
        @keyframes blinkR{0%,87%,100%{transform:scaleY(1)}90%,97%{transform:scaleY(0.08)}}
      `}</style>
      <g className="tail">
        <path d="M18,34 Q6,22 10,10 Q14,2 19,7" stroke="#e09040" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
      </g>
      <g className="cb">
        <ellipse cx="40" cy="37" rx="21" ry="13" fill="#f7b255"/>
        <ellipse cx="42" cy="39" rx="12" ry="8" fill="#fdd98a" opacity="0.7"/>
        <circle cx="60" cy="22" r="15" fill="#f7b255"/>
        <polygon points="49,11 52,1 58,11" fill="#f7b255"/>
        <polygon points="50,11 53,4 57,11" fill="#ffb3c1"/>
        <polygon points="61,11 65,1 70,11" fill="#f7b255"/>
        <polygon points="62,11 66,4 69,11" fill="#ffb3c1"/>
        <g className="eyeL"><ellipse cx="55" cy="20" rx="3.2" ry="3.8" fill="#2a1a0e"/><circle cx="56.2" cy="18.5" r="1.1" fill="white"/></g>
        <g className="eyeR"><ellipse cx="65" cy="20" rx="3.2" ry="3.8" fill="#2a1a0e"/><circle cx="66.2" cy="18.5" r="1.1" fill="white"/></g>
        <path d="M59,26 L61,28.5 L63,26 Z" fill="#ff8099"/>
        <path d="M61,28.5 Q58,31.5 55,30" stroke="#c06070" strokeWidth="1" fill="none" strokeLinecap="round"/>
        <path d="M61,28.5 Q64,31.5 67,30" stroke="#c06070" strokeWidth="1" fill="none" strokeLinecap="round"/>
        <line x1="44" y1="26" x2="56" y2="27" stroke="#ccc" strokeWidth="0.9"/>
        <line x1="44" y1="29" x2="56" y2="28.5" stroke="#ccc" strokeWidth="0.9"/>
        <line x1="64" y1="27" x2="78" y2="26" stroke="#ccc" strokeWidth="0.9"/>
        <line x1="64" y1="28.5" x2="78" y2="29" stroke="#ccc" strokeWidth="0.9"/>
        <g className="lbl"><rect x="22" y="47" width="7" height="12" rx="3.5" fill="#e09040"/><ellipse cx="25.5" cy="59" rx="4.5" ry="2" fill="#c87830"/></g>
        <g className="lbr"><rect x="31" y="47" width="7" height="12" rx="3.5" fill="#e09040"/><ellipse cx="34.5" cy="59" rx="4.5" ry="2" fill="#c87830"/></g>
        <g className="lfl"><rect x="49" y="47" width="7" height="12" rx="3.5" fill="#e09040"/><ellipse cx="52.5" cy="59" rx="4.5" ry="2" fill="#c87830"/></g>
        <g className="lfr"><rect x="58" y="47" width="7" height="12" rx="3.5" fill="#e09040"/><ellipse cx="61.5" cy="59" rx="4.5" ry="2" fill="#c87830"/></g>
      </g>
    </svg>
  );
}

// ─── Black cat SVG ────────────────────────────────────────────────────────────
// Identical silhouette to the orange cat but fully black, with white eyes.

function PuddleSVG({ speed }: { speed: number }) {
  const dur = Math.max(0.3, 0.7 - speed * 0.05) + "s";
  return (
    <svg width={PUDDLE_W} height={PUDDLE_H} viewBox="0 0 88 58" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
      <style>{`
        .pcb{animation:pbob ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:center}
        .plfl{animation:plA ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .plfr{animation:plB ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .plbl{animation:plB ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .plbr{animation:plA ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .ptail{animation:ptailSway 0.9s ease-in-out infinite;transform-box:fill-box;transform-origin:90% 40%}
        @keyframes pbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
        @keyframes plA{0%,100%{transform:rotate(-28deg) translateY(1px)}50%{transform:rotate(22deg) translateY(-1px)}}
        @keyframes plB{0%,100%{transform:rotate(22deg) translateY(-1px)}50%{transform:rotate(-28deg) translateY(1px)}}
        @keyframes ptailSway{0%,100%{transform:rotate(-18deg)}50%{transform:rotate(22deg)}}
      `}</style>
      {/* Tail */}
      <g className="ptail">
        <path d="M18,34 Q6,22 10,10 Q14,2 19,7" stroke="#111" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
      </g>
      {/* Body + head */}
      <g className="pcb">
        <ellipse cx="40" cy="37" rx="21" ry="13" fill="#111"/>
        <circle cx="60" cy="22" r="15" fill="#111"/>
        {/* Ears */}
        <polygon points="49,11 52,1 58,11" fill="#111"/>
        <polygon points="61,11 65,1 70,11" fill="#111"/>
        {/* Eyes — white with black pupils */}
        <ellipse cx="55" cy="20" rx="3.2" ry="3.8" fill="white"/>
        <ellipse cx="55" cy="20" rx="1.6" ry="2.2" fill="#111"/>
        <circle cx="55.8" cy="18.8" r="0.7" fill="white"/>
        <ellipse cx="65" cy="20" rx="3.2" ry="3.8" fill="white"/>
        <ellipse cx="65" cy="20" rx="1.6" ry="2.2" fill="#111"/>
        <circle cx="65.8" cy="18.8" r="0.7" fill="white"/>
        {/* Legs */}
        <g className="plbl"><rect x="22" y="47" width="7" height="12" rx="3.5" fill="#111"/></g>
        <g className="plbr"><rect x="31" y="47" width="7" height="12" rx="3.5" fill="#111"/></g>
        <g className="plfl"><rect x="49" y="47" width="7" height="12" rx="3.5" fill="#111"/></g>
        <g className="plfr"><rect x="58" y="47" width="7" height="12" rx="3.5" fill="#111"/></g>
      </g>
    </svg>
  );
}

// ─── Physics hook ─────────────────────────────────────────────────────────────

interface PhysicsConfig {
  gravity: number;
  airFriction: number;
  groundFriction: number;
  wallBounce: number;
  floorBounce: number;
  ceilBounce: number;
  scrollKickY: number;
  scrollKickX: number;
  baseSpeed: number;
  w: number;
  h: number;
  startX: number;
}

function useCreaturePhysics(cfg: PhysicsConfig, mounted: boolean, onScroll: (dy: number) => void) {
  const [pos, setPos] = useState({ x: cfg.startX, y: 0 });
  const [facingRight, setFacingRight] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [squish, setSquish] = useState(1);

  const posRef = useRef({ x: cfg.startX, y: 0 });
  const velRef = useRef({ x: cfg.baseSpeed, y: 0 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!mounted) return;

    posRef.current = { x: cfg.startX, y: window.innerHeight - cfg.h - 2 };
    setPos(posRef.current);

    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - lastTime, 50);
      lastTime = now;

      let { x, y } = posRef.current;
      let { x: vx, y: vy } = velRef.current;

      vy += cfg.gravity * (dt / 16);
      vx *= Math.pow(cfg.airFriction, dt / 16);
      vy *= Math.pow(cfg.airFriction, dt / 16);

      x += vx * (dt / 16);
      y += vy * (dt / 16);

      const maxX = window.innerWidth - cfg.w;
      const maxY = window.innerHeight - cfg.h - 2;

      if (x <= 0) { x = 0; vx = Math.abs(vx) * cfg.wallBounce; }
      if (x >= maxX) { x = maxX; vx = -Math.abs(vx) * cfg.wallBounce; }
      if (y <= 0) { y = 0; vy = Math.abs(vy) * cfg.ceilBounce; }

      if (y >= maxY) {
        y = maxY;
        const impact = Math.abs(vy);
        vy = -impact * cfg.floorBounce;
        if (impact > 2) setSquish(1 + impact * 0.08); // squish on hard landing
        else setSquish(1);
        if (Math.abs(vy) < 0.8) vy = 0;
        vx *= Math.pow(cfg.groundFriction, dt / 16);
        if (Math.abs(vx) < 0.4) vx = vx >= 0 ? cfg.baseSpeed : -cfg.baseSpeed;
      } else {
        setSquish(1);
      }

      velRef.current = { x: vx, y: vy };
      posRef.current = { x, y };
      setPos({ x, y });
      if (Math.abs(vx) > 0.1) setFacingRight(vx > 0);
      setSpeed(Math.min(8, Math.sqrt(vx * vx + vy * vy)));

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mounted, cfg.startX, cfg.w, cfg.h, cfg.gravity, cfg.airFriction, cfg.groundFriction, cfg.wallBounce, cfg.floorBounce, cfg.ceilBounce, cfg.baseSpeed]);

  // Expose kick for scroll
  const kick = (dy: number) => {
    if (Math.abs(dy) < 2) return;
    velRef.current.y -= dy * cfg.scrollKickY;
    velRef.current.x += (Math.random() - 0.5) * Math.abs(dy) * cfg.scrollKickX;
  };

  return { pos, facingRight, speed, squish, kick };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function WalkingCat() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const catKickRef = useRef<((dy: number) => void) | null>(null);
  const puddleKickRef = useRef<((dy: number) => void) | null>(null);
  const lastScrollY = useRef(0);

  useEffect(() => {
    if (!mounted) return;
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      const dy = window.scrollY - lastScrollY.current;
      lastScrollY.current = window.scrollY;
      catKickRef.current?.(dy);
      puddleKickRef.current?.(dy);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mounted]);

  const cat = useCreaturePhysics({
    gravity: 0.28, airFriction: 0.992, groundFriction: 0.96,
    wallBounce: 0.55, floorBounce: 0.42, ceilBounce: 0.45,
    scrollKickY: 0.4, scrollKickX: 0.25,
    baseSpeed: 0.7, w: CAT_W, h: CAT_H, startX: 120,
  }, mounted, () => {});
  catKickRef.current = cat.kick;

  // Puddle: bouncier, lighter, faster scroll reaction, slightly slower walk
  const puddle = useCreaturePhysics({
    gravity: 0.2, airFriction: 0.994, groundFriction: 0.965,
    wallBounce: 0.65, floorBounce: 0.6, ceilBounce: 0.55,
    scrollKickY: 0.55, scrollKickX: 0.4,
    baseSpeed: 0.55, w: PUDDLE_W, h: PUDDLE_H, startX: 260,
  }, mounted, () => {});
  puddleKickRef.current = puddle.kick;

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Orange cat */}
      <div style={{
        position: "fixed", left: cat.pos.x, top: cat.pos.y,
        zIndex: 9998, pointerEvents: "none", userSelect: "none",
        transform: cat.facingRight ? "scaleX(1)" : "scaleX(-1)",
        filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.18))",
        willChange: "left, top",
      }}>
        <CatSVG speed={cat.speed} />
      </div>

      {/* Black puddle */}
      <div style={{
        position: "fixed", left: puddle.pos.x, top: puddle.pos.y,
        zIndex: 9997, pointerEvents: "none", userSelect: "none",
        transform: puddle.facingRight ? "scaleX(1)" : "scaleX(-1)",
        willChange: "left, top",
      }}>
        <PuddleSVG speed={puddle.speed} />
      </div>
    </>,
    document.body
  );
}
