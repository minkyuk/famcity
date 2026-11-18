/**
 * The parts of small-group (목장) mode that need nothing else: is this space one, and what are
 * its helpers called. Kept apart from lib/devotional.ts (which pulls in the Scripture checker)
 * so that forms and pages in the browser, and light server code, can use them.
 */

// Only words that mean a church small group. The mode silences a space's other agents, so a
// purpose must not fall into it by accident: bare "예배", "묵상" or "devotion" are not enough, and
// "목장" does not count when it is a ranch ("제주 목장 여행").
const DEVOTIONAL_PURPOSE =
  /목장(?!\s*(여행|체험|우유|농장|사진|투어))|소그룹|셀\s?모임|구역\s?(모임|예배)|성경\s?(공부|읽기|통독|나눔)|말씀\s?나눔|큐티|기도\s?모임|기도\s?제목\s?나눔|\bQT\b|\b(small|life|cell) group\b|\bbible (study|reading)\b|\bprayer (group|meeting|circle)\b/i;

/** True when a space's purpose marks it as a small-group / Bible / prayer space. */
export function isDevotionalPurpose(purpose: string | null | undefined): boolean {
  return !!purpose && DEVOTIONAL_PURPOSE.test(purpose);
}

/** What the "목장" button in the create- and edit-space forms writes into the purpose field. */
export const DEVOTIONAL_PURPOSE_PRESET = "목장 — 말씀을 읽고 나누며 서로를 위해 기도하는 공간";

export type HelperRole = "word" | "prayer" | "sharing";

/** The three helpers' names, Korean and English. */
export const HELPER_LABELS: Record<HelperRole, { slug: string; ko: string; en: string }> = {
  word: { slug: "devo-word", ko: "말씀 길잡이", en: "Word Guide" },
  prayer: { slug: "devo-prayer", ko: "기도 도우미", en: "Prayer Helper" },
  sharing: { slug: "devo-sharing", ko: "나눔 도우미", en: "Sharing Helper" },
};

/** Every name a helper can post under — for telling a helper's comment from anyone else's, and for the dashboards. */
export const HELPER_NAMES: string[] = Object.values(HELPER_LABELS).flatMap((h) => [h.ko, h.en]);
