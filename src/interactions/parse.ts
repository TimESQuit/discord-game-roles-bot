import { UserFacingError } from "../errors.ts";

/** A strict positive integer ID (select value or autocomplete option); anything else throws `message`. */
export function parsePositiveId(raw: string | undefined, message: string): number {
  const trimmed = (raw ?? "").trim();
  if (!/^\d{1,15}$/.test(trimmed) || Number(trimmed) <= 0) throw new UserFacingError(message);
  return Number(trimmed);
}
