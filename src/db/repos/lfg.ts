import { sql } from "kysely";

import type { Kysely } from "kysely";
import type { DB } from "../kysely-types.ts";
import type { LfgAnswer, LfgOutcome, LfgPost, NewLfgPost } from "../types.ts";

export type LfgRepo = {
  /** Stores the post and its starting In list together. */
  add(post: NewLfgPost): Promise<void>;
  get(messageId: string): Promise<LfgPost | undefined>;
  setResponse(messageId: string, userId: string, kind: LfgAnswer | null): Promise<void>;
  /** Closes an open post; false if there was no open post to close. */
  close(messageId: string, outcome: LfgOutcome, by: string, at: string): Promise<boolean>;
  /** Undoes `close`, for when the closed post couldn't be redrawn. */
  reopen(messageId: string): Promise<void>;
};

export function createLfg(kysely: Kysely<DB>): LfgRepo {
  const usersOf = async (messageId: string, kind: LfgAnswer): Promise<string[]> => {
    const rows = await kysely
      .selectFrom("lfgResponses")
      .select("userId")
      .where("messageId", "=", messageId)
      .where("kind", "=", kind)
      .orderBy("respondedAt")
      .orderBy(sql`rowid`)
      .execute();
    return rows.map((row) => row.userId);
  };

  return {
    async add(post) {
      // Columns are picked, not spread: callers may pass a whole `LfgPost`.
      const { messageId, channelId, gameId, gameName, authorId, when, note, createdAt } = post;
      await kysely.transaction().execute(async (trx) => {
        await trx
          .insertInto("lfgPosts")
          .values({ messageId, channelId, gameId, gameName, authorId, when, note, createdAt })
          .execute();
        if (post.in.length === 0) return;
        await trx
          .insertInto("lfgResponses")
          .values(
            post.in.map((userId) => ({
              messageId,
              userId,
              kind: "in" as const,
              respondedAt: createdAt,
            })),
          )
          .execute();
      });
    },
    async get(messageId) {
      const row = await kysely
        .selectFrom("lfgPosts")
        .selectAll()
        .where("messageId", "=", messageId)
        .executeTakeFirst();
      if (!row) return undefined;
      return {
        ...row,
        in: await usersOf(messageId, "in"),
        maybe: await usersOf(messageId, "maybe"),
      };
    },
    async setResponse(messageId, userId, kind) {
      if (kind === null) {
        await kysely
          .deleteFrom("lfgResponses")
          .where("messageId", "=", messageId)
          .where("userId", "=", userId)
          .execute();
        return;
      }
      await kysely.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom("lfgResponses")
          .select("kind")
          .where("messageId", "=", messageId)
          .where("userId", "=", userId)
          .executeTakeFirst();
        if (existing?.kind === kind) return;
        // Delete then insert so a changed answer gets a fresh rowid, which breaks same-millisecond ties.
        await trx
          .deleteFrom("lfgResponses")
          .where("messageId", "=", messageId)
          .where("userId", "=", userId)
          .execute();
        await trx
          .insertInto("lfgResponses")
          .values({
            messageId,
            userId,
            kind,
            respondedAt: new Date().toISOString(),
          })
          .execute();
      });
    },
    async close(messageId, outcome, by, at) {
      const result = await kysely
        .updateTable("lfgPosts")
        .set({ status: outcome, closedBy: by, closedAt: at })
        .where("messageId", "=", messageId)
        .where("status", "=", "open")
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },
    async reopen(messageId) {
      await kysely
        .updateTable("lfgPosts")
        .set({ status: "open", closedBy: null, closedAt: null })
        .where("messageId", "=", messageId)
        .execute();
    },
  };
}
