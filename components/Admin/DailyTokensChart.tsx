import type { DailyTokens } from "@/lib/aiHealth";
import { TOKEN_CATEGORIES } from "@/lib/tokenCategories";

const SLOT = 30;
const BAR = 18;
const H = 140;
const GAP = 2;
const R = 4;
const fmt = (n: number) => n.toLocaleString("en-US");
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/** Rect with only the top corners rounded (square at the baseline). */
function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(R, h / 2, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Stacked daily bars of tokens by category — same shape as the Console usage chart, but says why. */
export function DailyTokensChart({ days }: { days: DailyTokens[] }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const width = Math.max(1, days.length) * SLOT;

  return (
    <figure className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4">
      <figcaption className="text-sm font-medium text-gray-700">일별 토큰 사용 (최근 14일, UTC)</figcaption>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
        {TOKEN_CATEGORIES.map((c) => (
          <li key={c.key} className="flex items-center gap-1">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
              <rect width={10} height={10} rx={2} fill={c.color} />
            </svg>
            {c.label}
          </li>
        ))}
      </ul>
      {days.length === 0 ? (
        <p className="text-sm text-gray-400">아직 기록이 없습니다. 이 기록은 대시보드 배포 이후부터 쌓입니다.</p>
      ) : (
        <>
          <p className="text-xs text-gray-400">가장 많은 날 {short(max)} 토큰 · PC에서는 막대에 마우스를 올리면 날짜별 내역이 보입니다</p>
          <svg viewBox={`0 0 ${width} ${H}`} className="h-auto w-full" role="img" aria-label="일별 토큰 사용량, 사용처별 누적 막대">
            <line x1={0} x2={width} y1={H} y2={H} className="stroke-[#c3c2b7]" strokeWidth={1} />
            {days.map((d, i) => {
              const x = i * SLOT + (SLOT - BAR) / 2;
              const segs = TOKEN_CATEGORIES.map((c) => ({ ...c, v: d.byCategory[c.key] })).filter((s) => s.v > 0);
              const tip = `${d.day}: 총 ${fmt(d.total)}\n` + segs.map((s) => `${s.label} ${fmt(s.v)}`).join("\n");
              let y = H;
              return (
                <g key={d.day} className="group">
                  <title>{tip}</title>
                  <rect x={i * SLOT} y={0} width={SLOT} height={H} className="fill-transparent group-hover:fill-gray-100" />
                  {segs.map((s, j) => {
                    const h = (s.v / max) * (H - 4);
                    y -= h;
                    const segY = y;
                    if (j < segs.length - 1) y -= GAP;
                    return j === segs.length - 1 ? (
                      <path key={s.key} d={topRounded(x, segY, BAR, h)} fill={s.color} />
                    ) : (
                      <rect key={s.key} x={x} y={segY} width={BAR} height={h} fill={s.color} />
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <div className="flex justify-between text-xs text-gray-400" aria-hidden>
            <span>{days[0].day.slice(5)}</span>
            <span>{days[days.length - 1].day.slice(5)}</span>
          </div>
        </>
      )}
    </figure>
  );
}
