"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CAT_W = 88;
const CAT_H = 58;

function CatSVG({ speed }: { speed: number }) {
  const dur = Math.max(0.18, 0.42 - speed * 0.04) + "s";
  return (
    <svg width={CAT_W} height={CAT_H} viewBox="0 0 88 58" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        .cb { animation: bob ${dur} ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .lfl { animation: lA ${dur} ease-in-out infinite; transform-box: fill-box; transform-origin: top center; }
        .lfr { animation: lB ${dur} ease-in-out infinite; transform-box: fill-box; transform-origin: top center; }
        .lbl { animation: lB ${dur} ease-in-out infinite; transform-box: fill-box; transform-origin: top center; }
        .lbr { animation: lA ${dur} ease-in-out infinite; transform-box: fill-box; transform-origin: top center; }
        .tail { animation: tailSway 0.9s ease-in-out infinite; transform-box: fill-box; transform-origin: 90% 40%; }
        .eyeL { animation: blinkL 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .eyeR { animation: blinkR 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes bob {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-2.5px); }
        }
        @keyframes lA {
          0%,100% { transform: rotate(-28deg) translateY(1px); }
          50% { transform: rotate(22deg) translateY(-1px); }
        }
        @keyframes lB {
          0%,100% { transform: rotate(22deg) translateY(-1px); }
          50% { transform: rotate(-28deg) translateY(1px); }
        }
        @keyframes tailSway {
          0%,100% { transform: rotate(-18deg); }
          50% { transform: rotate(22deg); }
        }
        @keyframes blinkL {
          0%,85%,100% { transform: scaleY(1); }
          88%,96% { transform: scaleY(0.08); }
        }
        @keyframes blinkR {
          0%,87%,100% { transform: scaleY(1); }
          90%,97% { transform: scaleY(0.08); }
        }
      `}</style>

      {/* Tail — behind body */}
      <g className="tail">
        <path d="M18,34 Q6,22 10,10 Q14,2 19,7" stroke="#e09040" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
      </g>

      <g className="cb">
        {/* Body */}
        <ellipse cx="40" cy="37" rx="21" ry="13" fill="#f7b255"/>
        {/* Belly */}
        <ellipse cx="42" cy="39" rx="12" ry="8" fill="#fdd98a" opacity="0.7"/>

        {/* Head */}
        <circle cx="60" cy="22" r="15" fill="#f7b255"/>

        {/* Ear left */}
        <polygon points="49,11 52,1 58,11" fill="#f7b255"/>
        <polygon points="50,11 53,4 57,11" fill="#ffb3c1"/>

        {/* Ear right */}
        <polygon points="61,11 65,1 70,11" fill="#f7b255"/>
        <polygon points="62,11 66,4 69,11" fill="#ffb3c1"/>

        {/* Eyes */}
        <g className="eyeL">
          <ellipse cx="55" cy="20" rx="3.2" ry="3.8" fill="#2a1a0e"/>
          <circle cx="56.2" cy="18.5" r="1.1" fill="white"/>
        </g>
        <g className="eyeR">
          <ellipse cx="65" cy="20" rx="3.2" ry="3.8" fill="#2a1a0e"/>
          <circle cx="66.2" cy="18.5" r="1.1" fill="white"/>
        </g>

        {/* Nose */}
        <path d="M59,26 L61,28.5 L63,26 Z" fill="#ff8099"/>
        {/* Mouth */}
        <path d="M61,28.5 Q58,31.5 55,30" stroke="#c06070" strokeWidth="1" fill="none" strokeLinecap="round"/>
        <path d="M61,28.5 Q64,31.5 67,30" stroke="#c06070" strokeWidth="1" fill="none" strokeLinecap="round"/>

        {/* Whiskers */}
        <line x1="44" y1="26" x2="56" y2="27" stroke="#ccc" strokeWidth="0.9"/>
        <line x1="44" y1="29" x2="56" y2="28.5" stroke="#ccc" strokeWidth="0.9"/>
        <line x1="64" y1="27" x2="78" y2="26" stroke="#ccc" strokeWidth="0.9"/>
        <line x1="64" y1="28.5" x2="78" y2="29" stroke="#ccc" strokeWidth="0.9"/>

        {/* Back legs */}
        <g className="lbl">
          <rect x="22" y="47" width="7" height="12" rx="3.5" fill="#e09040"/>
          <ellipse cx="25.5" cy="59" rx="4.5" ry="2" fill="#c87830"/>
        </g>
        <g className="lbr">
          <rect x="31" y="47" width="7" height="12" rx="3.5" fill="#e09040"/>
          <ellipse cx="34.5" cy="59" rx="4.5" ry="2" fill="#c87830"/>
        </g>

        {/* Front legs */}
        <g className="lfl">
          <rect x="49" y="47" width="7" height="12" rx="3.5" fill="#e09040"/>
          <ellipse cx="52.5" cy="59" rx="4.5" ry="2" fill="#c87830"/>
        </g>
        <g className="lfr">
          <rect x="58" y="47" width="7" height="12" rx="3.5" fill="#e09040"/>
          <ellipse cx="61.5" cy="59" rx="4.5" ry="2" fill="#c87830"/>
        </g>
      </g>
    </svg>
  );
}

export function WalkingCat() {
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ x: 120, y: 0 });
  const [facingRight, setFacingRight] = useState(true);
  const [speed, setSpeed] = useState(1);

  const posRef = useRef({ x: 120, y: 0 });
  const velRef = useRef({ x: 1.8, y: 0 });
  const rafRef = useRef<number>(0);
  const lastScrollY = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;

    posRef.current = { x: 120, y: window.innerHeight - CAT_H - 2 };
    setPos(posRef.current);
    lastScrollY.current = window.scrollY;

    // Scroll → pinball kick
    const onScroll = () => {
      const dy = window.scrollY - lastScrollY.current;
      lastScrollY.current = window.scrollY;
      if (Math.abs(dy) < 2) return;
      // Kick opposite to scroll direction + random horizontal burst
      velRef.current.y -= dy * 0.55;
      velRef.current.x += (Math.random() - 0.5) * Math.abs(dy) * 0.4;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - lastTime, 50);
      lastTime = now;

      let { x, y } = posRef.current;
      let { x: vx, y: vy } = velRef.current;

      // Gravity
      vy += 0.45 * (dt / 16);

      // Air friction
      vx *= Math.pow(0.994, dt / 16);
      vy *= Math.pow(0.994, dt / 16);

      x += vx * (dt / 16);
      y += vy * (dt / 16);

      const maxX = window.innerWidth - CAT_W;
      const maxY = window.innerHeight - CAT_H - 2;

      // Bounce: left/right walls
      if (x <= 0) { x = 0; vx = Math.abs(vx) * 0.75; }
      if (x >= maxX) { x = maxX; vx = -Math.abs(vx) * 0.75; }

      // Bounce: ceiling
      if (y <= 0) { y = 0; vy = Math.abs(vy) * 0.65; }

      // Bounce: floor
      if (y >= maxY) {
        y = maxY;
        vy = -Math.abs(vy) * 0.62;
        if (Math.abs(vy) < 0.8) vy = 0;
        // Ground friction
        vx *= Math.pow(0.97, dt / 16);
        // Keep walking if nearly stopped horizontally
        if (Math.abs(vx) < 0.5) vx = vx >= 0 ? 1.2 : -1.2;
      }

      velRef.current = { x: vx, y: vy };
      posRef.current = { x, y };
      setPos({ x, y });
      if (Math.abs(vx) > 0.1) setFacingRight(vx > 0);
      setSpeed(Math.min(8, Math.sqrt(vx * vx + vy * vy)));

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", onScroll);
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9998,
        pointerEvents: "none",
        userSelect: "none",
        transform: facingRight ? "scaleX(1)" : "scaleX(-1)",
        filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.18))",
        willChange: "transform, left, top",
      }}
    >
      <CatSVG speed={speed} />
    </div>,
    document.body
  );
}
