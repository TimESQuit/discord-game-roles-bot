import type { LfgAnswer, LfgPost, NewLfgPost } from "../db/index.ts";

/** Clicking your current answer clears it; clicking the other one switches. */
export function toggleResponse(current: LfgAnswer | null, clicked: LfgAnswer): LfgAnswer | null {
  return current === clicked ? null : clicked;
}

/** A post as it stands when first stored: open, with nobody on Maybe. */
export const openLfgPost = (post: NewLfgPost): LfgPost => ({
  ...post,
  status: "open",
  closedBy: null,
  closedAt: null,
  maybe: [],
});
