import type { HourBucket } from "@/lib/aiHealth";

const SLOT = 20; // px per hour in the viewBox
const BAR = 12; // bar thickness (<= 24px, leftover is air)
const H = 120; // plot height
const GAP = 2; // surface gap between stacked segments
const R = 4; // rounded data-end radius

/** Rect with only the top corners rounded (square at the baseline). */
function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(R, h / 2, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Stacked hourly columns: successful calls (bottom) and failed calls (top), last 24h. */
export function HourlyCallsChart({ hourly }: { hourly: HourBucket[] }) {
  const max = Math.max(1, ...hourly.map((b) => b.ok + b.errors));
  const scale = (n: number) => (n / max) * (H - 4);
  const width = hourly.length * SLOT;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-gray-700">시간별 AI 호출 (최근 24시간)</span>
        <span className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0ca30c]" />✓ 성공</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#d03b3b]" />✕ 실패</span>
        </span>
      </figcaption>
      <p className="text-xs text-gray-400">막대 높이 = 그 시간의 호출 수 · 회색 선 = {Math.round(max / 2)}건 · 최대 {max}건</p>
      <svg viewBox={`0 0 ${width} ${H}`} className="w-full h-auto" role="img" aria-label="시간별 AI 호출 성공/실패 막대 차트">
        <line x1={0} x2={width} y1={H / 2} y2={H / 2} className="stroke-[#e1e0d9]" strokeWidth={1} />
        <line x1={0} x2={width} y1={H} y2={H} className="stroke-[#c3c2b7]" strokeWidth={1} />
        {hourly.map((b, i) => {
          const x = i * SLOT + (SLOT - BAR) / 2;
          const okH = scale(b.ok);
          const errH = scale(b.errors);
          const okY = H - okH;
          const errY = okY - (b.ok > 0 && b.errors > 0 ? GAP : 0) - errH;
          const label = b.hoursAgo === 0 ? "지난 1시간" : `${b.hoursAgo}–${b.hoursAgo + 1}시간 전`;
          return (
            <g key={b.hoursAgo} className="group">
              <title>{`${label}: 성공 ${b.ok} · 실패 ${b.errors}`}</title>
              <rect x={i * SLOT} y={0} width={SLOT} height={H} className="fill-transparent group-hover:fill-gray-100" />
              {b.ok > 0 && (b.errors > 0
                ? <rect x={x} y={okY} width={BAR} height={okH} className="fill-[#0ca30c]" />
                : <path d={topRounded(x, okY, BAR, okH)} className="fill-[#0ca30c]" />)}
              {b.errors > 0 && <path d={topRounded(x, errY, BAR, errH)} className="fill-[#d03b3b]" />}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-gray-400" aria-hidden>
        <span>24시간 전</span><span>18</span><span>12</span><span>6</span><span>지금</span>
      </div>
    </figure>
  );
}
