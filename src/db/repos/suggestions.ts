import type { Kysely } from "kysely";
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
  /** Writes only while the suggestion is still pending; false means it was already decided. */
  updatePending(
    id: number,
    patch: Partial<Pick<Suggestion, "name" | "categoryId" | "aliases">>,
  ): Promise<boolean>;
  remove(id: number): Promise<void>;
  setReviewMessage(id: number, messageId: string): Promise<void>;
  setGame(id: number, gameId: number | null): Promise<void>;
};

export function createSuggestions(kysely: Kysely<DB>): SuggestionsRepo {
  const select = () => kysely.selectFrom("suggestions").selectAll();
  const get = (id: number): Promise<Suggestion | undefined> =>
    select().where("id", "=", id).executeTakeFirst();
  const pending = () =>
    kysely
      .selectFrom("suggestions")
      .where("status", "=", "pending")
      .orderBy("createdAt")
      .orderBy("id");

  return {
    async add(input) {
      const result = await kysely.insertInto("suggestions").values(input).executeTakeFirstOrThrow();
      const created = await get(Number(result.insertId));
      if (!created) throw new Error("suggestion vanished after insert");
      return created;
    },
    get,
    listByUser: (userId) =>
      select()
        .where("suggesterId", "=", userId)
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .execute(),
    listPending: () => pending().selectAll().execute(),
    async countPending(userId) {
      const row = await kysely
        .selectFrom("suggestions")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("suggesterId", "=", userId)
        .where("status", "=", "pending")
        .executeTakeFirstOrThrow();
      return row.n;
    },
    pendingNames: () => pending().select(["id", "name"]).execute(),
    async decide(id, to, by, at, reason) {
      const result = await kysely
        .updateTable("suggestions")
        .set({
          status: to,
          reviewerId: by,
          rejectionReason: to === "rejected" ? (reason ?? null) : null,
          decidedAt: at,
        })
        .where("id", "=", id)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },
    async undoDecision(id) {
      await kysely
        .updateTable("suggestions")
        .set({ status: "pending", reviewerId: null, rejectionReason: null, decidedAt: null })
        .where("id", "=", id)
        .execute();
    },
    async updatePending(id, patch) {
      if (Object.values(patch).every((value) => value === undefined)) {
        return (await get(id))?.status === "pending";
      }
      const result = await kysely
        .updateTable("suggestions")
        .set(patch)
        .where("id", "=", id)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },
    async remove(id) {
      await kysely.deleteFrom("suggestions").where("id", "=", id).execute();
    },
    async setReviewMessage(id, messageId) {
      await kysely
        .updateTable("suggestions")
        .set({ reviewMessageId: messageId })
        .where("id", "=", id)
        .execute();
    },
    async setGame(id, gameId) {
      await kysely.updateTable("suggestions").set({ gameId }).where("id", "=", id).execute();
    },
  };
}
