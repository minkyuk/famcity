/** Spaces shown first in every space list, in this order. Matched by name (they are created by name). */
export const PINNED_SPACE_NAMES = ["Family News", "The Curiosity Den"] as const;

const rank = (name: string): number => {
  const i = (PINNED_SPACE_NAMES as readonly string[]).indexOf(name);
  return i === -1 ? PINNED_SPACE_NAMES.length : i;
};

export const isPinnedSpaceName = (name: string): boolean => rank(name) < PINNED_SPACE_NAMES.length;

/** Pinned spaces first (in PINNED_SPACE_NAMES order); everything else keeps its existing order. */
export function pinSpacesFirst<T extends { name: string }>(spaces: T[]): T[] {
  return spaces
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.name) - rank(b.s.name) || a.i - b.i)
    .map(({ s }) => s);
}
