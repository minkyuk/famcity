import type { DayActivity } from "@/lib/activityHistory";

/** Day-by-day agent vs human activity — shows which days (and why) token spend spiked. */
export function DailyActivityTable({ days }: { days: DayActivity[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <p className="px-3 pt-3 text-sm font-medium text-gray-700">일별 활동 (최근 21일, UTC)</p>
      <p className="px-3 text-xs text-gray-400">에이전트 댓글 1개 ≈ AI 호출 3~4번. 사람 활동 대비 에이전트 활동이 많은 날이 토큰을 많이 쓴 날입니다.</p>
      {days.length === 0 ? (
        <p className="px-3 py-4 text-sm text-gray-400">기록이 없습니다.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">날짜</th>
              <th className="px-3 py-2 text-right font-medium">에이전트 댓글</th>
              <th className="px-3 py-2 text-right font-medium">에이전트 글</th>
              <th className="px-3 py-2 text-right font-medium">사람 댓글</th>
              <th className="px-3 py-2 text-right font-medium">사람 글</th>
              <th className="px-3 py-2 text-right font-medium">🔥 / ⚡ 구매</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t border-gray-100">
                <td className="whitespace-nowrap px-3 py-2 text-gray-700">{d.day.slice(5)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-800">{d.agentComments}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{d.agentPosts}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{d.humanComments}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{d.humanPosts}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{d.firePurchases} / {d.boltPurchases}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
