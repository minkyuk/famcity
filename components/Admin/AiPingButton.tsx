"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PingResult =
  | { ok: true; model: string; ms: number }
  | { ok: false; model: string; ms: number; status?: number; errorType: string; message: string };

/** Narrow the untyped JSON from the health endpoint into a PingResult (or null if malformed). */
function parsePingResult(v: unknown): PingResult | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>; // narrowed to a non-null object above
  const model = typeof o.model === "string" ? o.model : "";
  const ms = typeof o.ms === "number" ? o.ms : 0;
  if (o.ok === true) return { ok: true, model, ms };
  if (o.ok === false) {
    return {
      ok: false, model, ms,
      status: typeof o.status === "number" ? o.status : undefined,
      errorType: typeof o.errorType === "string" ? o.errorType : "other",
      message: typeof o.message === "string" ? o.message : "",
    };
  }
  return null;
}

/** Fires one tiny live request to Claude and shows the result; refreshes the dashboard after. */
export function AiPingButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PingResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function ping() {
    setBusy(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/admin/agents/health", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = parsePingResult(await res.json());
      if (!data) throw new Error("응답 형식이 올바르지 않습니다");
      setResult(data);
      router.refresh();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={ping}
        disabled={busy}
        className="self-start rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {busy ? "확인 중…" : "지금 API 테스트"}
      </button>
      {result?.ok && (
        <p className="text-sm text-[#006300]">✓ 정상 응답 ({result.model}, {result.ms}ms)</p>
      )}
      {result && !result.ok && (
        <p className="text-sm text-red-700">
          ✕ 실패 [{result.errorType}{result.status ? ` · ${result.status}` : ""}] {result.message}
        </p>
      )}
      {fetchError && <p className="text-sm text-red-700">테스트 요청 자체가 실패했습니다: {fetchError}</p>}
    </div>
  );
}
