import { sql } from "kysely";

import type { Kysely } from "kysely";
import type { DB } from "../kysely-types.ts";
import type { LfgAnswer, LfgPost } from "../types.ts";

export type LfgRepo = {
  /** Stores the post and its starting In list together. */
  add(post: Omit<LfgPost, "maybe">): Promise<void>;
  get(messageId: string): Promise<LfgPost | undefined>;
  setResponse(messageId: string, userId: string, kind: LfgAnswer | null): Promise<void>;
};

export function createLfg(kysely: Kysely<DB>): LfgRepo {
  const usersOf = async (messageId: string, kind: LfgAnswer): Promise<string[]> => {
    const rows = await kysely
      .selectFrom("lfg_responses")
      .select("user_id")
      .where("message_id", "=", messageId)
      .where("kind", "=", kind)
      .orderBy("responded_at")
      .orderBy(sql`rowid`)
      .execute();
    return rows.map((row) => row.user_id);
  };

  return {
    async add(post) {
      await kysely.transaction().execute(async (trx) => {
        await trx
          .insertInto("lfg_posts")
          .values({
            message_id: post.messageId,
            channel_id: post.channelId,
            game_id: post.gameId,
            game_name: post.gameName,
            author_id: post.authorId,
            when: post.when,
            note: post.note,
            created_at: post.createdAt,
          })
          .execute();
        for (const userId of post.in) {
          await trx
            .insertInto("lfg_responses")
            .values({
              message_id: post.messageId,
              user_id: userId,
              kind: "in",
              responded_at: post.createdAt,
            })
            .execute();
        }
      });
    },
    async get(messageId) {
      const row = await kysely
        .selectFrom("lfg_posts")
        .selectAll()
        .where("message_id", "=", messageId)
        .executeTakeFirst();
      if (!row) return undefined;
      return {
        messageId: row.message_id,
        channelId: row.channel_id,
        gameId: row.game_id,
        gameName: row.game_name,
        authorId: row.author_id,
        when: row.when,
        note: row.note,
        createdAt: row.created_at,
        in: await usersOf(messageId, "in"),
        maybe: await usersOf(messageId, "maybe"),
      };
    },
    async setResponse(messageId, userId, kind) {
      if (kind === null) {
        await kysely
          .deleteFrom("lfg_responses")
          .where("message_id", "=", messageId)
          .where("user_id", "=", userId)
          .execute();
        return;
      }
      await kysely.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom("lfg_responses")
          .select("kind")
          .where("message_id", "=", messageId)
          .where("user_id", "=", userId)
          .executeTakeFirst();
        if (existing?.kind === kind) return;
        // Delete then insert so a changed answer gets a fresh rowid, which breaks same-millisecond ties.
        await trx
          .deleteFrom("lfg_responses")
          .where("message_id", "=", messageId)
          .where("user_id", "=", userId)
          .execute();
        await trx
          .insertInto("lfg_responses")
          .values({
            message_id: messageId,
            user_id: userId,
            kind,
            responded_at: new Date().toISOString(),
          })
          .execute();
      });
    },
  };
}
