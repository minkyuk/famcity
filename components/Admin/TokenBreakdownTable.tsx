import type { AiHealth } from "@/lib/aiHealth";

/** Plain-language names for the logged code paths. Unknown labels fall back to the raw label. */
const LABELS: Record<string, string> = {
  "discuss:runDirectTurn": "사람 댓글에 즉시 답하기",
  "discuss:runAgentAction": "정기 댓글 (기사 에이전트)",
  "discuss:tryCreateDenPost": "Den 새 글",
  "discuss:spaceComment": "스페이스 에이전트 댓글",
  "discuss:spacePost": "스페이스 에이전트 새 글",
  "discuss:runFafoTurn": "FAFO 모드",
  "discuss:isNovel": "검사: 중복 여부",
  "discuss:isFactuallyHumble": "검사: 사실 확인",
  "discuss:isOnTopicAndHelpful": "검사: 주제 적합성",
  "discuss:findThreadGaps": "대화 빈틈 분석",
  "discuss:extractFlightParams": "항공권 검색 해석",
  "news:vote": "뉴스: 투표",
  "news:report": "뉴스: 기사 작성",
  "news:debate": "뉴스: 찬반 의견",
  "news:reportKorean": "뉴스: 한국어 기사",
  "news:koreanFeed": "뉴스: 한국 뉴스",
  "translate:translate": "번역",
  "admin-ping": "API 테스트 버튼",
  analyze: "분석 페이지",
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** Where the last 24h of tokens went, biggest first — shows which agent behaviour to trim. */
export function TokenBreakdownTable({ rows }: { rows: AiHealth["byRoute"] }) {
  const total = rows.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <p className="px-3 pt-3 text-sm font-medium text-gray-700">토큰 사용처 (24시간)</p>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-gray-400">아직 기록이 없습니다.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">어디서</th>
              <th className="px-3 py-2 text-right font-medium">호출</th>
              <th className="px-3 py-2 text-right font-medium">토큰 (입력 / 출력)</th>
              <th className="px-3 py-2 text-right font-medium">비중</th>
              <th className="px-3 py-2 text-right font-medium">예상 비용</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tokens = r.inputTokens + r.outputTokens;
              return (
                <tr key={r.route} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700" title={r.route}>{LABELS[r.route] ?? r.route}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmt(r.calls)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-600">{fmt(r.inputTokens)} / {fmt(r.outputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-800">{total ? Math.round((tokens / total) * 100) : 0}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">${r.costUsd.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
