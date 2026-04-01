"use client";

import { useEffect, useState } from "react";

export function PassiveModeButton() {
  const [active, setActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/agents/passive");
      const data = res.ok ? await res.json().catch(() => ({})) : {};
      setActive(!!data.active);
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
          ? "Passive mode ON — knights wait for human input before replying (3 fires/hr each). Click to disable."
          : "Passive mode OFF — click to enable quiet mode (knights wait for humans)"
      }
      className={`text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
        active ? "text-violet-500 hover:text-violet-700" : "text-gray-400 hover:text-violet-400"
      }`}
    >
      ☽
    </button>
  );
}
