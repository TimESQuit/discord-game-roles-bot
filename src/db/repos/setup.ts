import type { Kysely } from "kysely";
import type { DB } from "../kysely-types.ts";
import type { SetupKey } from "../types.ts";

export type SetupRepo = {
  get(key: SetupKey): Promise<string | undefined>;
  set(key: SetupKey, value: string): Promise<void>;
  all(): Promise<Partial<Record<SetupKey, string>>>;
};

export function createSetup(kysely: Kysely<DB>): SetupRepo {
  return {
    async get(key) {
      const row = await kysely
        .selectFrom("setup")
        .select("value")
        .where("key", "=", key)
        .executeTakeFirst();
      return row?.value;
    },
    async set(key, value) {
      await kysely
        .insertInto("setup")
        .values({ key, value })
        .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
        .execute();
    },
    async all() {
      const result: Partial<Record<SetupKey, string>> = {};
      for (const row of await kysely.selectFrom("setup").select(["key", "value"]).execute()) {
        result[row.key as SetupKey] = row.value;
      }
      return result;
    },
  };
}
