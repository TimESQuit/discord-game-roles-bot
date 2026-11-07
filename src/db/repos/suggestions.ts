import type { Kysely, Selectable } from "kysely";
import type { DB } from "../kysely-types.ts";
import type { Suggestion, SuggestionStatus } from "../types.ts";

export type SuggestionsRepo = {
  add(
    input: Pick<Suggestion, "suggesterId" | "name" | "categoryId" | "note" | "createdAt">,
  ): Promise<Suggestion>;
  get(id: number): Promise<Suggestion | undefined>;
  listByUser(userId: string): Promise<Suggestion[]>;
  listPending(): Promise<Suggestion[]>;
  countPending(userId: string): Promise<number>;
  pendingNames(): Promise<{ id: number; name: string }[]>;
  decide(
    id: number,
    to: Exclude<SuggestionStatus, "pending">,
    by: string,
    at: string,
    reason?: string,
  ): Promise<boolean>;
  undoDecision(id: number): Promise<void>;
  update(
    id: number,
    patch: Partial<Pick<Suggestion, "name" | "categoryId" | "note" | "aliases">>,
  ): Promise<void>;
  setReviewMessage(id: number, messageId: string): Promise<void>;
  setGame(id: number, gameId: number | null): Promise<void>;
};

function toSuggestion(row: Selectable<DB["suggestions"]>): Suggestion {
  return {
    id: row.id,
    suggesterId: row.suggester_id,
    name: row.name,
    categoryId: row.category_id,
    note: row.note,
    status: row.status as SuggestionStatus,
    reviewerId: row.reviewer_id,
    rejectionReason: row.rejection_reason,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    reviewMessageId: row.review_message_id,
    gameId: row.game_id,
    aliases: row.aliases,
  };
}

export function createSuggestions(kysely: Kysely<DB>): SuggestionsRepo {
  const select = () => kysely.selectFrom("suggestions").selectAll();

  const get = async (id: number): Promise<Suggestion | undefined> => {
    const row = await select().where("id", "=", id).executeTakeFirst();
    return row ? toSuggestion(row) : undefined;
  };

  return {
    async add(input) {
      const result = await kysely
        .insertInto("suggestions")
        .values({
          suggester_id: input.suggesterId,
          name: input.name,
          category_id: input.categoryId,
          note: input.note,
          created_at: input.createdAt,
        })
        .executeTakeFirstOrThrow();
      const created = await get(Number(result.insertId));
      if (!created) throw new Error("suggestion vanished after insert");
      return created;
    },
    get,
    async listByUser(userId) {
      const rows = await select()
        .where("suggester_id", "=", userId)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .execute();
      return rows.map(toSuggestion);
    },
    async listPending() {
      const rows = await select()
        .where("status", "=", "pending")
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      return rows.map(toSuggestion);
    },
    async countPending(userId) {
      const row = await kysely
        .selectFrom("suggestions")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("suggester_id", "=", userId)
        .where("status", "=", "pending")
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },
    async pendingNames() {
      return kysely
        .selectFrom("suggestions")
        .select(["id", "name"])
        .where("status", "=", "pending")
        .orderBy("created_at")
        .orderBy("id")
        .execute();
    },
    async decide(id, to, by, at, reason) {
      const result = await kysely
        .updateTable("suggestions")
        .set({
          status: to,
          reviewer_id: by,
          rejection_reason: to === "rejected" ? (reason ?? null) : null,
          decided_at: at,
        })
        .where("id", "=", id)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },
    async undoDecision(id) {
      await kysely
        .updateTable("suggestions")
        .set({ status: "pending", reviewer_id: null, rejection_reason: null, decided_at: null })
        .where("id", "=", id)
        .execute();
    },
    async update(id, patch) {
      const set: {
        name?: string;
        category_id?: number;
        note?: string | null;
        aliases?: string | null;
      } = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.categoryId !== undefined) set.category_id = patch.categoryId;
      if (patch.note !== undefined) set.note = patch.note;
      if (patch.aliases !== undefined) set.aliases = patch.aliases;
      if (Object.keys(set).length === 0) return;
      await kysely.updateTable("suggestions").set(set).where("id", "=", id).execute();
    },
    async setReviewMessage(id, messageId) {
      await kysely
        .updateTable("suggestions")
        .set({ review_message_id: messageId })
        .where("id", "=", id)
        .execute();
    },
    async setGame(id, gameId) {
      await kysely
        .updateTable("suggestions")
        .set({ game_id: gameId })
        .where("id", "=", id)
        .execute();
    },
  };
}
