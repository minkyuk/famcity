import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { loadAiHealth, loadDailyTokens } from "@/lib/aiHealth";
import { DailyTokensChart } from "@/components/Admin/DailyTokensChart";
import { AgentTokenBars } from "@/components/Admin/AgentTokenBars";
import { timeAgoKo } from "@/lib/timeAgoKo";
import { AiStatusBanner } from "@/components/Admin/AiStatusBanner";
import { StatTile } from "@/components/Admin/StatTile";
import { HourlyCallsChart } from "@/components/Admin/HourlyCallsChart";
import { AiPingButton } from "@/components/Admin/AiPingButton";
import { TokenBreakdownTable } from "@/components/Admin/TokenBreakdownTable";
import { DailyActivityTable } from "@/components/Admin/DailyActivityTable";
import { loadDailyActivity } from "@/lib/activityHistory";

export const dynamic = "force-dynamic";

const ERROR_LABELS: Record<string, string> = {
  billing: "크레딧/결제",
  rate_limit: "사용 한도/속도 제한",
  auth: "API 키",
  not_found: "모델 없음",
  overloaded: "Anthropic 과부하 (자동 재시도)",
  server: "Anthropic 서버 오류",
  invalid_request: "잘못된 요청",
  network: "네트워크",
  other: "기타",
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** Admin-only AI health dashboard: are agents able to call Claude, and if not, why. */
export default async function AdminAgentHealthPage() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) redirect("/");

  const [h, history, dailyTokens] = await Promise.all([
    loadAiHealth(),
    loadDailyActivity().catch(() => []),
    loadDailyTokens().catch(() => []),
  ]);
  const now = Date.now();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">에이전트 AI 상태</h1>
          <p className="text-sm text-gray-500">에이전트가 Claude API를 쓸 수 있는지, 안 된다면 왜인지 보여줍니다. 관리자만 볼 수 있습니다.</p>
        </div>
        <AiPingButton />
      </div>

      {h.tableError && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          AI 호출 기록 테이블을 만들지 못했습니다: {h.tableError}
        </p>
      )}

      <AiStatusBanner status={h.status} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="AI 호출 (24시간)" value={fmt(h.calls24h)} />
        <StatTile label="실패 (24시간)" value={fmt(h.errors24h)} sub={h.calls24h ? `${Math.round((h.errors24h / h.calls24h) * 100)}%` : undefined} />
        <StatTile label="토큰 (입력 / 출력)" value={`${fmt(h.inputTokens24h)} / ${fmt(h.outputTokens24h)}`} />
        <StatTile
          label="예상 비용 (24시간)"
          value={`$${h.costUsd24h.toFixed(2)}`}
          sub={h.unpricedCalls24h ? `가격 미확인 ${h.unpricedCalls24h}건 제외` : "모델별 단가로 추정"}
        />
        <StatTile label="마지막 성공" value={timeAgoKo(h.lastSuccessAt, now)} />
        <StatTile label="에이전트 댓글 / 글 (24시간)" value={`${fmt(h.agentComments24h)} / ${fmt(h.agentPosts24h)}`} sub={`마지막 댓글 ${timeAgoKo(h.lastAgentCommentAt, now)}`} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <HourlyCallsChart hourly={h.hourly} />
      </div>

      <DailyTokensChart days={dailyTokens} />

      <AgentTokenBars rows={h.byAgent} />

      <TokenBreakdownTable rows={h.byRoute} />

      <DailyActivityTable days={history} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="크론: 에이전트 (5분마다)" value={timeAgoKo(h.cronDiscussAt, now)} />
        <StatTile label="크론: 뉴스 (2시간마다)" value={timeAgoKo(h.cronNewsAt, now)} />
        <StatTile label="사람 댓글로 깨운 마지막 실행" value={timeAgoKo(h.userTriggerAt, now)} />
      </div>

      {h.errorsByType.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-gray-700">실패 원인 (24시간)</p>
          <ul className="flex flex-wrap gap-2">
            {h.errorsByType.map((e) => (
              <li key={e.type} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                {ERROR_LABELS[e.type] ?? e.type} · <span className="font-semibold tabular-nums">{fmt(e.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <p className="px-3 pt-3 text-sm font-medium text-gray-700">최근 실패 20건</p>
        {h.recentErrors.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-400">기록된 실패가 없습니다.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">언제</th>
                <th className="px-3 py-2 text-left font-medium">어디서</th>
                <th className="px-3 py-2 text-left font-medium">원인</th>
                <th className="px-3 py-2 text-left font-medium">메시지</th>
              </tr>
            </thead>
            <tbody>
              {h.recentErrors.map((e, i) => (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500" title={e.at.toISOString()}>{timeAgoKo(e.at, now)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{e.route}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {ERROR_LABELS[e.errorType ?? "other"] ?? e.errorType}{e.status ? ` (${e.status})` : ""}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 break-words">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Anthropic API는 남은 크레딧 잔액을 알려주지 않기 때문에, 이 화면은 실제 호출 결과(성공/실패 사유)로 상태를 판단합니다.
        비용은 응답의 토큰 수로 계산한 추정치이며, 스트리밍 호출(분석 기능)의 토큰은 포함되지 않습니다. 기록은 14일간 보관됩니다.
      </p>
    </div>
  );
}
