import { normalize } from "../../normalize.ts";

import type { Kysely } from "kysely";
import type { DB } from "../kysely-types.ts";
import type { Game } from "../types.ts";

export type GamesRepo = {
  list(): Promise<Game[]>;
  get(id: number): Promise<Game | undefined>;
  add(input: Omit<Game, "id">): Promise<Game>;
  update(id: number, patch: Partial<Pick<Game, "name" | "categoryId" | "aliases">>): Promise<Game>;
  remove(id: number): Promise<void>;
};

/** The columns a `Game` carries; the search key stays in the database. */
const GAME_COLUMNS = [
  "id",
  "name",
  "categoryId",
  "roleId",
  "addedBy",
  "addedAt",
] as const satisfies readonly (keyof Game)[];

async function writeAliases(kysely: Kysely<DB>, gameId: number, aliases: string[]): Promise<void> {
  await kysely.deleteFrom("gameAliases").where("gameId", "=", gameId).execute();
  const normalized = [...new Set(aliases.map(normalize).filter((alias) => alias !== ""))];
  if (normalized.length === 0) return;
  await kysely
    .insertInto("gameAliases")
    .values(normalized.map((alias) => ({ gameId, alias })))
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export function createGames(kysely: Kysely<DB>): GamesRepo {
  const get = async (id: number): Promise<Game | undefined> => {
    const row = await kysely
      .selectFrom("games")
      .select(GAME_COLUMNS)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return undefined;
    const aliases = await kysely
      .selectFrom("gameAliases")
      .select("alias")
      .where("gameId", "=", id)
      .orderBy("alias")
      .execute();
    return { ...row, aliases: aliases.map((a) => a.alias) };
  };

  const getOrThrow = async (id: number): Promise<Game> => {
    const game = await get(id);
    if (!game) throw new Error(`unknown game ${id}`);
    return game;
  };

  return {
    async list() {
      const [rows, aliases] = await Promise.all([
        kysely.selectFrom("games").select(GAME_COLUMNS).orderBy("normalizedName").execute(),
        kysely.selectFrom("gameAliases").select(["gameId", "alias"]).orderBy("alias").execute(),
      ]);
      const byGame = Map.groupBy(aliases, (a) => a.gameId);
      return rows.map((row) => ({
        ...row,
        aliases: (byGame.get(row.id) ?? []).map((a) => a.alias),
      }));
    },
    get,
    async add({ aliases, ...input }) {
      const id = await kysely.transaction().execute(async (trx) => {
        const result = await trx
          .insertInto("games")
          .values({ ...input, normalizedName: normalize(input.name) })
          .executeTakeFirstOrThrow();
        const gameId = Number(result.insertId);
        await writeAliases(trx, gameId, aliases);
        return gameId;
      });
      return getOrThrow(id);
    },
    async update(id, { aliases, ...patch }) {
      await kysely.transaction().execute(async (trx) => {
        const set = {
          ...patch,
          ...(patch.name === undefined ? {} : { normalizedName: normalize(patch.name) }),
        };
        if (Object.values(set).some((value) => value !== undefined)) {
          await trx.updateTable("games").set(set).where("id", "=", id).execute();
        }
        if (aliases !== undefined) await writeAliases(trx, id, aliases);
      });
      return getOrThrow(id);
    },
    async remove(id) {
      await kysely.deleteFrom("games").where("id", "=", id).execute();
    },
  };
}
