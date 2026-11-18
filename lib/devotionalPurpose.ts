/**
 * Is this a small-group (목장) / Bible / prayer space? Kept apart from lib/devotional.ts, which
 * pulls in server-only code, so that forms and pages in the browser can use it too.
 */
const DEVOTIONAL_PURPOSE = /목장|셀\s?모임|구역\s?모임|소그룹|성경\s?(공부|읽기|통독|나눔)|말씀\s?나눔|큐티|묵상|기도\s?(모임|제목|나눔)|예배|\bqt\b|small group|life group|cell group|bible study|bible reading|devotion|prayer (group|meeting|circle)|quiet time/i;

/** True when a space's purpose marks it as a small-group / Bible / prayer space. */
export function isDevotionalPurpose(purpose: string | null | undefined): boolean {
  return !!purpose && DEVOTIONAL_PURPOSE.test(purpose);
}

/** What the "목장" button in the create-space form writes into the purpose field. */
export const DEVOTIONAL_PURPOSE_PRESET = "목장 — 말씀을 읽고 나누며 서로를 위해 기도하는 공간";
