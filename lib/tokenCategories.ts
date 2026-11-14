/** Groups the per-call labels ("discuss:isNovel", "news:vote", ...) into a few readable buckets. */
export const TOKEN_CATEGORIES = [
  { key: "direct", label: "사람에게 즉시 답하기", color: "#2a78d6" },
  { key: "routine", label: "정기 댓글·글", color: "#eb6834" },
  { key: "space", label: "스페이스 에이전트", color: "#1baf7a" },
  { key: "gate", label: "검사·분석", color: "#eda100" },
  { key: "news", label: "뉴스", color: "#e87ba4" },
  { key: "other", label: "기타", color: "#008300" },
] as const;

export type TokenCategory = (typeof TOKEN_CATEGORIES)[number]["key"];

export function categoryOf(route: string): TokenCategory {
  if (route.startsWith("news")) return "news";
  const purpose = route.split(":")[1] ?? "";
  if (purpose === "runDirectTurn" || purpose === "runFafoTurn") return "direct";
  if (purpose === "runAgentAction" || purpose === "tryCreateDenPost") return "routine";
  if (purpose === "spaceComment" || purpose === "spacePost") return "space";
  if (["isNovel", "isFactuallyHumble", "isOnTopicAndHelpful", "findThreadGaps", "extractFlightParams"].includes(purpose)) return "gate";
  return "other";
}
