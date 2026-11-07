import type { LfgAnswer } from "../db/index.ts";

/** Clicking your current answer clears it; clicking the other one switches. */
export function toggleResponse(current: LfgAnswer | null, clicked: LfgAnswer): LfgAnswer | null {
  return current === clicked ? null : clicked;
}
