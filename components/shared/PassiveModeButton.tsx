"use client";

import { useEffect, useState } from "react";
import { PASSIVE_MODE_HOURS } from "@/lib/agentModes";

export function PassiveModeButton() {
  const [active, setActive] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/agents/passive");
      const data = res.ok ? await res.json().catch(() => ({})) : {};
      setActive(!!data.active);
      setRemaining(typeof data.remainingMinutes === "number" ? data.remainingMinutes : 0);
    } catch {
      setActive(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  if (active === null) return null;

  const toggle = async () => {
    setLoading(true);
    try {
      await fetch("/api/agents/passive", { method: active ? "DELETE" : "POST" });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={
        active
          ? `Passive mode ON — knights wait for human input before replying (3 fires/hr each). Turns off automatically in ${Math.floor(remaining / 60)}h ${remaining % 60}m. Click to disable.`
          : `Passive mode OFF — click to enable quiet mode for ${PASSIVE_MODE_HOURS}h (knights wait for humans)`
      }
      className={`text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
        active ? "text-violet-500 hover:text-violet-700" : "text-gray-400 hover:text-violet-400"
      }`}
    >
      ☽
    </button>
  );
}
