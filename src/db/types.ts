import type {
  categories,
  games,
  LFG_ANSWERS,
  LFG_STATUSES,
  lfgPosts,
  SETUP_KEYS,
  suggestions,
  SUGGESTION_STATUSES,
} from "./schema.ts";

export type Category = typeof categories.$inferSelect;

/** A game row without its search key, plus its aliases from their own table. */
export type Game = Omit<typeof games.$inferSelect, "normalizedName"> & { aliases: string[] };

export type SetupKey = (typeof SETUP_KEYS)[number];

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export type Suggestion = typeof suggestions.$inferSelect;

export type LfgAnswer = (typeof LFG_ANSWERS)[number];

export type LfgStatus = (typeof LFG_STATUSES)[number];

/** How a closed post ended. */
export type LfgOutcome = Exclude<LfgStatus, "open">;

/** A post row plus who answered each way, from the responses table. */
export type LfgPost = typeof lfgPosts.$inferSelect & Record<LfgAnswer, string[]>;

/** A post as it is first stored: open, with its starting In list. */
export type NewLfgPost = Omit<LfgPost, "maybe" | "status" | "closedBy" | "closedAt">;
