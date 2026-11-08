import { MESSAGES } from "../constants.ts";
import { UserFacingError } from "../errors.ts";

/** A strict positive integer ID (select value or autocomplete option); anything else throws `message`. */
export function parsePositiveId(raw: string | undefined, message: string): number {
  const trimmed = (raw ?? "").trim();
  if (!/^\d{1,15}$/.test(trimmed) || Number(trimmed) <= 0) throw new UserFacingError(message);
  return Number(trimmed);
}

/** A game ID from a game dropdown or a `game` autocomplete option. */
export const parseGameId = (raw: string | undefined): number =>
  parsePositiveId(raw, MESSAGES.pickGame);

/** A category ID from a category dropdown or a `category` autocomplete option. */
export const parseCategoryId = (raw: string | undefined): number =>
  parsePositiveId(raw, MESSAGES.pickCategory);
