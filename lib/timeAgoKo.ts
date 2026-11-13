/** "방금 전", "5분 전", "3시간 전", "2일 전" — or "기록 없음" for null. */
export function timeAgoKo(date: Date | null, now: number = Date.now()): string {
  if (!date) return "기록 없음";
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return "방금 전";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}
