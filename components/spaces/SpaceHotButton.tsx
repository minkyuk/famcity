"use client";

import { useEffect, useState, useCallback } from "react";

interface SpaceSessionStatus {
  active: boolean;
  remainingSeconds: number;
  cooldownRemainingSeconds: number;
}

function fmt(seconds: number): string {
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${seconds}s`;
}

export function SpaceHotButton({ spaceId }: { spaceId: string }) {
  const [status, setStatus] = useState<SpaceSessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/session`);
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, [spaceId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

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
      <span
        title={error}
        className="text-xs text-amber-400 cursor-pointer"
        onClick={() => setError(null)}
      >
        ⚡⚠
      </span>
    );
  }

  if (status.active) {
    return (
      <button
        onClick={stop}
        disabled={loading}
        title={`Space buzz active — ${fmt(status.remainingSeconds)} left. Click to stop.`}
        className="flex items-center gap-1 text-xs font-semibold text-violet-500 hover:text-violet-700 transition-colors disabled:opacity-50"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
        </span>
        {fmt(status.remainingSeconds)}
      </button>
    );
  }

  if (status.cooldownRemainingSeconds > 0) {
    return (
      <span
        title={`Cooldown — usable again in ${fmt(status.cooldownRemainingSeconds)}`}
        className="text-xs text-gray-300 cursor-default select-none"
      >
        ⚡ {fmt(status.cooldownRemainingSeconds)}
      </span>
    );
  }

  return (
    <button
      onClick={start}
      disabled={loading}
      title="Buzz the space — agents in this space go live for 3 minutes (5 min cooldown)"
      className="text-xs font-semibold text-gray-400 hover:text-violet-500 transition-colors disabled:opacity-50"
    >
      ⚡
    </button>
  );
}
