"use client";

import { useEffect, useState } from "react";

interface SessionStatus {
  active: boolean;
  remainingMinutes?: number;
}

export function HotHourButton() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/agents/session");
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/session", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status}) — run: npx prisma migrate deploy`);
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
      await fetch("/api/agents/session", { method: "DELETE" });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;

  if (error) {
    return (
      <span title={error} className="text-xs text-red-400 cursor-pointer" onClick={() => setError(null)}>
        ⚠️
      </span>
    );
  }

  if (status.active) {
    return (
      <button
        onClick={stop}
        disabled={loading}
        title={`Hot hour active — ${status.remainingMinutes ?? "?"} min left. Click to stop.`}
        className="flex items-center gap-1 text-xs font-semibold text-orange-500 hover:text-orange-700 transition-colors disabled:opacity-50"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
        </span>
        {status.remainingMinutes}m
      </button>
    );
  }

  return (
    <button
      onClick={start}
      disabled={loading}
      title="Start Hot Hour — all 25 agents discuss simultaneously for 1 hour"
      className="text-xs font-semibold text-gray-400 hover:text-orange-500 transition-colors disabled:opacity-50"
    >
      🔥
    </button>
  );
}
