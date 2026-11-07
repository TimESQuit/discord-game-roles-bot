import type { SETUP_KEYS, SUGGESTION_STATUSES } from "./schema.ts";

export type Category = { id: number; name: string; position: number };

export type Game = {
  id: number;
  name: string;
  categoryId: number;
  roleId: string;
  aliases: string[];
  addedBy: string;
  addedAt: string;
};

export type SetupKey = (typeof SETUP_KEYS)[number];

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export type Suggestion = {
  id: number;
  suggesterId: string;
  name: string;
  categoryId: number;
  note: string | null;
  status: SuggestionStatus;
  reviewerId: string | null;
  rejectionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  reviewMessageId: string | null;
  gameId: number | null;
  aliases: string | null;
};

export type LfgPost = {
  messageId: string;
  channelId: string;
  gameId: number | null;
  gameName: string;
  authorId: string;
  when: string | null;
  note: string | null;
  createdAt: string;
  in: string[];
  maybe: string[];
};
