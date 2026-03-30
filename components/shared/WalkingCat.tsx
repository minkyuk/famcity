"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CAT_W = 88;
const CAT_H = 58;
const PUDDLE_W = 64;
const PUDDLE_H = 52;

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

// ─── Black puddle SVG ─────────────────────────────────────────────────────────
// Uses CSS <style> animations (same approach as CatSVG) with pu-prefixed class
// names to avoid any conflict with the cat's global class names.

function PuddleSVG({ speed }: { speed: number }) {
  const dur = Math.max(0.35, 0.8 - speed * 0.05) + "s";
  return (
    <svg width={PUDDLE_W} height={PUDDLE_H} viewBox="0 0 64 52" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
      <style>{`
        .pul1{animation:puA ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .pul2{animation:puB ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .pul3{animation:puA ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .pul4{animation:puB ${dur} ease-in-out infinite;transform-box:fill-box;transform-origin:top center}
        .putail{animation:puTail 1.1s ease-in-out infinite;transform-box:fill-box;transform-origin:80% 50%}
        @keyframes puA{0%,100%{transform:rotate(-15deg)}50%{transform:rotate(15deg)}}
        @keyframes puB{0%,100%{transform:rotate(15deg)}50%{transform:rotate(-15deg)}}
        @keyframes puTail{0%,100%{transform:rotate(-20deg)}50%{transform:rotate(20deg)}}
      `}</style>

      {/* Tail */}
      <g className="putail">
        <path d="M14,34 Q3,22 7,12 Q10,4 15,8" stroke="#4a2a6e" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Body */}
      <ellipse cx="32" cy="36" rx="20" ry="11" fill="#3b1f5e"/>
      <ellipse cx="30" cy="31" rx="9" ry="5" fill="#5a3a80" opacity="0.7"/>

      {/* Head */}
      <circle cx="44" cy="22" r="13" fill="#3b1f5e"/>
      <ellipse cx="42" cy="17" rx="5" ry="4" fill="#5a3a80" opacity="0.5"/>

      {/* Ears */}
      <ellipse cx="35" cy="11" rx="4" ry="5" fill="#3b1f5e"/>
      <ellipse cx="52" cy="11" rx="4" ry="5" fill="#3b1f5e"/>
      <ellipse cx="35" cy="11" rx="2" ry="3" fill="#c060c0" opacity="0.8"/>
      <ellipse cx="52" cy="11" rx="2" ry="3" fill="#c060c0" opacity="0.8"/>

      {/* Left eye */}
      <circle cx="39" cy="21" r="5" fill="#0a0520"/>
      <circle cx="39" cy="21" r="3.5" fill="#dde0ff"/>
      <circle cx="39" cy="21" r="2" fill="#0a0520"/>
      <circle cx="40.2" cy="19.8" r="1" fill="white"/>

      {/* Right eye */}
      <circle cx="50" cy="21" r="5" fill="#0a0520"/>
      <circle cx="50" cy="21" r="3.5" fill="#dde0ff"/>
      <circle cx="50" cy="21" r="2" fill="#0a0520"/>
      <circle cx="51.2" cy="19.8" r="1" fill="white"/>

      {/* Nose */}
      <ellipse cx="44" cy="27" rx="2" ry="1.3" fill="#7a4a9a"/>

      {/* Legs — CSS animated via pu-prefixed classes */}
      <g className="pul1"><rect x="20" y="42" width="6" height="10" rx="3" fill="#2a1040"/></g>
      <g className="pul2"><rect x="28" y="42" width="6" height="10" rx="3" fill="#2a1040"/></g>
      <g className="pul3"><rect x="36" y="42" width="6" height="10" rx="3" fill="#2a1040"/></g>
      <g className="pul4"><rect x="44" y="42" width="6" height="10" rx="3" fill="#2a1040"/></g>
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
