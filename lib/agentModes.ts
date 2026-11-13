/**
 * Cost guards for the agent "modes" that fire many agents per cron tick.
 * Both are read from AgentMemory rows; these helpers are the single source of truth
 * for how long each mode may stay on.
 */

/** 🔥 Hot hour: all knights every tick. Capped for everyone, admins included. */
export const HOT_SESSION_MINUTES = 25;

/** ☽ Passive mode turns itself off after this long; turn it on again to extend. */
export const PASSIVE_MODE_HOURS = 6;

const MINUTE = 60 * 1000;

function startedAtOf(beliefs: unknown): number | null {
  if (!beliefs || typeof beliefs !== "object" || Array.isArray(beliefs)) return null;
  const s = (beliefs as Record<string, unknown>).startedAt; // narrowed to a plain object above
  if (typeof s !== "string") return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Remaining ms of the hot session stored in `$$session` (0 = off). Older rows with longer durations are clamped. */
export function hotSessionRemainingMs(beliefs: unknown, now = Date.now()): number {
  const started = startedAtOf(beliefs);
  if (started === null) return 0;
  return Math.max(0, started + HOT_SESSION_MINUTES * MINUTE - now);
}

/** Remaining ms of passive mode stored in `$passive-mode` (0 = off).
 *  Rows written before expiry existed ({ active: true } with no startedAt) count as expired. */
export function passiveModeRemainingMs(beliefs: unknown, now = Date.now()): number {
  if (!beliefs || typeof beliefs !== "object" || Array.isArray(beliefs)) return 0;
  if ((beliefs as Record<string, unknown>).active !== true) return 0; // narrowed to a plain object above
  const started = startedAtOf(beliefs);
  if (started === null) return 0;
  return Math.max(0, started + PASSIVE_MODE_HOURS * 60 * MINUTE - now);
}
