import type { OwnMessage } from "../discord/index.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Milliseconds until the next `hourUtc`:00 UTC; exactly on the hour means tomorrow, so it is always > 0. */
export function msUntilNextRun(now: Date, hourUtc: number): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc);
  const diff = next - now.getTime();
  return diff > 0 ? diff : diff + DAY_MS;
}

/** IDs of attachment posts strictly older than `maxAgeDays`. */
export function selectExpiredBackups(
  messages: readonly OwnMessage[],
  now: Date,
  maxAgeDays: number,
): string[] {
  const cutoff = now.getTime() - maxAgeDays * DAY_MS;
  return messages.filter((m) => m.hasAttachment && m.createdAt.getTime() < cutoff).map((m) => m.id);
}
