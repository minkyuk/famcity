import type { AiHealth } from "@/lib/aiHealth";

const TOP_N = 15;
const fmt = (n: number) => n.toLocaleString("en-US");

/** Horizontal bars: share of the last 24h tokens per agent (top 15, rest folded into "그 외"). */
export function AgentTokenBars({ rows }: { rows: AiHealth["byAgent"] }) {
  const total = rows.reduce((s, r) => s + r.tokens, 0);
  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  const shown = rest.length
    ? [
        ...top,
        {
          agent: `그 외 ${rest.length}명`,
          calls: rest.reduce((s, r) => s + r.calls, 0),
          tokens: rest.reduce((s, r) => s + r.tokens, 0),
          costUsd: rest.reduce((s, r) => s + r.costUsd, 0),
        },
      ]
    : top;
  const max = Math.max(1, ...shown.map((r) => r.tokens));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-medium text-gray-700">에이전트별 토큰 분포 (24시간)</p>
      <p className="mb-3 text-xs text-gray-400">그 에이전트 차례에 쓴 모든 호출(검사 포함)을 합친 값입니다.</p>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400">아직 기록이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((r) => {
            const pct = total ? (r.tokens / total) * 100 : 0;
            return (
              <li
                key={r.agent}
                className="flex items-center gap-2 text-xs"
                title={`${r.agent}: ${fmt(r.tokens)} 토큰 · ${fmt(r.calls)}회 · $${r.costUsd.toFixed(3)}`}
              >
                <span className="w-28 shrink-0 truncate text-gray-700">{r.agent}</span>
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-2.5 min-w-0 flex-1" aria-hidden>
                  <rect x={0} y={0} width={(r.tokens / max) * 100} height={10} className="fill-[#2a78d6]" />
                </svg>
                <span className="w-24 shrink-0 text-right tabular-nums text-gray-600">
                  {Math.round(pct)}% · {fmt(r.tokens)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
