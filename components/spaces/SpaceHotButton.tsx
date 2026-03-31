"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";

interface SpaceSessionStatus {
  active: boolean;
  remainingSeconds: number;
  cooldownRemainingSeconds: number;
}

function fmtCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtCooldown(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${seconds}s`;
}

export function SpaceHotButton({ spaceId }: { spaceId: string }) {
  const { data: session } = useSession();
  const isAdmin = !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  const [status, setStatus] = useState<SpaceSessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/session`);
      if (!res.ok) return;
      const data: SpaceSessionStatus = await res.json();
      setStatus(data);
      setRemaining(data.remainingSeconds);
      setCooldown(data.cooldownRemainingSeconds);
    } catch {}
  }, [spaceId]);

  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 15_000);
    return () => clearInterval(poll);
  }, [fetchStatus]);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/session`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to start");
        return;
      }
      fetch("/api/agents/discuss", { method: "POST" }).catch(() => {});
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetch(`/api/spaces/${spaceId}/session`, { method: "DELETE" });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;

  if (error) {
    return (
      <span title={error} className="text-xs text-amber-400 cursor-pointer" onClick={() => setError(null)}>
        ⚡⚠
      </span>
    );
  }

  if (status.active && remaining > 0) {
    return (
      <button
        onClick={stop}
        disabled={loading}
        title="Space buzz active — click to stop"
        className="flex items-center gap-1.5 text-xs font-semibold text-violet-500 hover:text-violet-700 transition-colors disabled:opacity-50"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
        </span>
        {fmtCountdown(remaining)}
      </button>
    );
  }

  if (cooldown > 0) {
    if (isAdmin) {
      // Admins can override cooldown
      return (
        <button
          onClick={start}
          disabled={loading}
          title={`Cooldown (${fmtCooldown(cooldown)} left) — click to override`}
          className="text-xs font-semibold text-gray-300 hover:text-violet-500 transition-colors disabled:opacity-50"
        >
          ⚡ {fmtCooldown(cooldown)}
        </button>
      );
    }
    return (
      <span
        title={`Cooldown — usable again in ${fmtCooldown(cooldown)}`}
        className="text-xs text-gray-300 cursor-default select-none tabular-nums"
      >
        ⚡ {fmtCooldown(cooldown)}
      </span>
    );
  }

  return (
    <button
      onClick={start}
      disabled={loading}
      title="Buzz the space — agents go live for 3 minutes (20 min cooldown)"
      className="text-xs font-semibold text-gray-400 hover:text-violet-500 transition-colors disabled:opacity-50"
    >
      ⚡
    </button>
  );
}
