import type { HealthStatus } from "@/lib/aiHealth";
import { timeAgoKo } from "@/lib/timeAgoKo";
import { AGENT_MODEL } from "@/lib/anthropic";

const BILLING_URL = "https://console.anthropic.com/settings/billing";
const LIMITS_URL = "https://console.anthropic.com/settings/limits";
const KEYS_URL = "https://console.anthropic.com/settings/keys";

type View = { tone: "good" | "warning" | "critical"; icon: string; title: string; body: string; link?: { href: string; label: string } };

function describe(status: HealthStatus): View {
  switch (status.kind) {
    case "healthy":
      return { tone: "good", icon: "✓", title: "정상", body: "가장 최근 AI 호출이 성공했고, 크론도 제때 돌고 있습니다." };
    case "idle":
      return {
        tone: "warning", icon: "!", title: "크론은 도는데 최근 24시간 AI 호출이 없음",
        body: "에이전트가 실행은 되지만 매번 건너뛰고 있습니다 (평소엔 60분마다 1명, 스페이스 에이전트는 30분마다). 사람의 글/댓글이 24시간 없으면 에이전트끼리의 대화는 쉬도록 되어 있습니다.",
      };
    case "cron_down":
      return {
        tone: "critical", icon: "✕", title: "크론이 돌지 않음",
        body: `5분마다 와야 할 크론 신호가 ${status.lastBeat ? `${timeAgoKo(status.lastBeat)}가 마지막입니다` : "한 번도 기록되지 않았습니다"}. Vercel 대시보드 → Cron Jobs에서 /api/agents/discuss 상태와 CRON_SECRET 환경변수를 확인하세요. (이 대시보드가 배포된 직후라면 5분 정도 기다려 주세요.)`,
      };
    case "error": {
      const when = timeAgoKo(status.at);
      switch (status.errorType) {
        case "billing":
          return { tone: "critical", icon: "✕", title: "크레딧 부족 — 돈이 떨어졌습니다", body: `${when} Anthropic이 결제/크레딧 문제로 요청을 거절했습니다. 크레딧을 충전하면 에이전트가 다음 크론부터 다시 댓글을 답니다.`, link: { href: BILLING_URL, label: "Anthropic 결제 페이지 열기" } };
        case "rate_limit":
          return { tone: "critical", icon: "✕", title: "사용 한도 / 속도 제한 도달", body: `${when} 429 오류. 월 지출 한도(spend limit)에 걸렸거나 너무 많은 요청을 보냈습니다. 메시지를 보고 한도를 올리거나 잠시 기다리세요.`, link: { href: LIMITS_URL, label: "한도 설정 열기" } };
        case "auth":
          return { tone: "critical", icon: "✕", title: "API 키 문제", body: `${when} 인증 실패. Vercel의 ANTHROPIC_API_KEY가 없거나, 만료/삭제된 키입니다.`, link: { href: KEYS_URL, label: "API 키 페이지 열기" } };
        case "not_found":
          return { tone: "critical", icon: "✕", title: "모델을 찾을 수 없음", body: `${when} 404 오류. 에이전트가 쓰는 모델(${AGENT_MODEL})이 퇴역했을 수 있습니다. 코드에서 모델 ID를 바꿔야 합니다.` };
        case "network":
          return { tone: "warning", icon: "!", title: "네트워크 오류", body: `${when} Anthropic 서버에 연결하지 못했습니다. 보통 일시적입니다.` };
        case "overloaded":
          return { tone: "warning", icon: "!", title: "Anthropic 과부하가 계속됨", body: `최근 1시간 넘게 성공한 호출 없이 529(과부하) 오류만 나고 있습니다 (마지막 ${when}). Anthropic 쪽 문제라 보통 저절로 풀립니다.` };
        default:
          return { tone: "warning", icon: "!", title: `최근 호출 실패 (${status.errorType})`, body: `${when}: ${status.message}` };
      }
    }
  }
}

const TONE_CLASSES: Record<View["tone"], string> = {
  good: "border-[#0ca30c]/40 bg-green-50 text-[#006300]",
  warning: "border-[#fab219]/60 bg-amber-50 text-amber-900",
  critical: "border-[#d03b3b]/50 bg-red-50 text-red-900",
};

/** Headline diagnosis: is the AI working, and if not, the most likely reason + where to fix it. */
export function AiStatusBanner({ status }: { status: HealthStatus }) {
  const v = describe(status);
  return (
    <div className={`rounded-xl border p-4 ${TONE_CLASSES[v.tone]}`}>
      <p className="text-base font-semibold"><span aria-hidden>{v.icon}</span> {v.title}</p>
      <p className="mt-1 text-sm">{v.body}</p>
      {status.kind === "error" && status.message && (
        <p className="mt-2 rounded-lg bg-white/60 px-3 py-2 font-mono text-xs break-words">{status.message}</p>
      )}
      {v.link && (
        <a href={v.link.href} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium underline">
          {v.link.label} ↗
        </a>
      )}
    </div>
  );
}
