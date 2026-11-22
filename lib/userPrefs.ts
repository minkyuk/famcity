/**
 * A person's own settings for how the app looks to them (pure; storage is lib/userPrefsStore.ts).
 * Kept per account, so they follow the person to every device. Add a setting by adding a key
 * here with its default — rows saved before it existed read as that default.
 */
export type UserPrefs = {
  /** The cat and the dog that roam the screen. */
  pets: boolean;
  /** The floating music button (and its player). */
  music: boolean;
};

export const DEFAULT_PREFS: UserPrefs = { pets: true, music: true };

export const PREFS_SLUG_PREFIX = "$$prefs:";
export const prefsSlug = (userId: string) => `${PREFS_SLUG_PREFIX}${userId}`;

/** Reads stored settings; anything missing or malformed falls back to its default. */
export function readPrefs(json: unknown): UserPrefs {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {}; // our own row
  const bool = (key: keyof UserPrefs) => (typeof o[key] === "boolean" ? (o[key] as boolean) : DEFAULT_PREFS[key]); // narrowed by the typeof check
  return { pets: bool("pets"), music: bool("music") };
}
