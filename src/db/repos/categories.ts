import { sql } from "kysely";

import type { Kysely } from "kysely";
import type { MoveDirection } from "../../constants.ts";
import type { DB } from "../kysely-types.ts";
import type { Category } from "../types.ts";

export type CategoriesRepo = {
  list(): Promise<Category[]>;
  get(id: number): Promise<Category | undefined>;
  add(name: string): Promise<Category>;
  rename(id: number, name: string): Promise<void>;
  move(id: number, dir: MoveDirection): Promise<void>;
};

export function createCategories(kysely: Kysely<DB>): CategoriesRepo {
  const get = (id: number): Promise<Category | undefined> =>
    kysely
      .selectFrom("categories")
      .select(["id", "name", "position"])
      .where("id", "=", id)
      .executeTakeFirst();

  return {
    async list() {
      return kysely
        .selectFrom("categories")
        .select(["id", "name", "position"])
        .orderBy("position")
        .orderBy("id")
        .execute();
    },
    get,
    async add(name) {
      return kysely.transaction().execute(async (trx) => {
        const max = await trx
          .selectFrom("categories")
          .select(sql<number>`COALESCE(MAX(position), -1)`.as("m"))
          .executeTakeFirstOrThrow();
        const position = max.m + 1;
        const result = await trx
          .insertInto("categories")
          .values({ name, position })
          .executeTakeFirstOrThrow();
        return { id: Number(result.insertId), name, position };
      });
    },
    async rename(id, name) {
      await kysely.updateTable("categories").set({ name }).where("id", "=", id).execute();
    },
    async move(id, dir) {
      await kysely.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom("categories")
          .select(["id", "position"])
          .where("id", "=", id)
          .executeTakeFirst();
        if (!current) return;
        const base = trx.selectFrom("categories").select(["id", "position"]);
        const neighbor = await (
          dir === "up"
            ? base.where("position", "<", current.position).orderBy("position", "desc")
            : base.where("position", ">", current.position).orderBy("position", "asc")
        )
          .limit(1)
          .executeTakeFirst();
        if (!neighbor) return;
        await trx
          .updateTable("categories")
          .set({ position: neighbor.position })
          .where("id", "=", current.id)
          .execute();
        await trx
          .updateTable("categories")
          .set({ position: current.position })
          .where("id", "=", neighbor.id)
          .execute();
      });
    },
  };
}
