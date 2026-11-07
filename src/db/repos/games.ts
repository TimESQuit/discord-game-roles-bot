import type { Kysely, Selectable } from "kysely";
import { normalize } from "../../domain/index.ts";
import type { DB } from "../kysely-types.ts";
import type { Game } from "../types.ts";

export type GamesRepo = {
  list(): Promise<Game[]>;
  get(id: number): Promise<Game | undefined>;
  byRoleId(roleId: string): Promise<Game | undefined>;
  byNormalizedName(name: string): Promise<Game | undefined>;
  add(input: Omit<Game, "id">): Promise<Game>;
  update(id: number, patch: Partial<Pick<Game, "name" | "categoryId" | "aliases">>): Promise<Game>;
  remove(id: number): Promise<void>;
  ownsRole(roleId: string): Promise<boolean>;
};

type GameRow = Selectable<DB["games"]>;

async function writeAliases(kysely: Kysely<DB>, gameId: number, aliases: string[]): Promise<void> {
  await kysely.deleteFrom("game_aliases").where("game_id", "=", gameId).execute();
  const normalized = [...new Set(aliases.map(normalize).filter((alias) => alias !== ""))];
  if (normalized.length === 0) return;
  await kysely
    .insertInto("game_aliases")
    .values(normalized.map((alias) => ({ game_id: gameId, alias })))
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export function createGames(kysely: Kysely<DB>): GamesRepo {
  const aliasesOf = async (gameId: number): Promise<string[]> => {
    const rows = await kysely
      .selectFrom("game_aliases")
      .select("alias")
      .where("game_id", "=", gameId)
      .orderBy("alias")
      .execute();
    return rows.map((r) => r.alias);
  };

  const toGame = async (row: GameRow): Promise<Game> => ({
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    roleId: row.role_id,
    aliases: await aliasesOf(row.id),
    addedBy: row.added_by,
    addedAt: row.added_at,
  });

  const select = () => kysely.selectFrom("games").selectAll();

  const one = async (row: Promise<GameRow | undefined>): Promise<Game | undefined> => {
    const found = await row;
    return found ? toGame(found) : undefined;
  };

  const get = (id: number) => one(select().where("id", "=", id).executeTakeFirst());

  return {
    async list() {
      const rows = await select().orderBy("normalized_name").execute();
      const games: Game[] = [];
      for (const row of rows) games.push(await toGame(row));
      return games;
    },
    get,
    byRoleId: (roleId) => one(select().where("role_id", "=", roleId).executeTakeFirst()),
    byNormalizedName: (name) =>
      one(select().where("normalized_name", "=", normalize(name)).executeTakeFirst()),
    async add(input) {
      const id = await kysely.transaction().execute(async (trx) => {
        const result = await trx
          .insertInto("games")
          .values({
            name: input.name,
            normalized_name: normalize(input.name),
            category_id: input.categoryId,
            role_id: input.roleId,
            added_by: input.addedBy,
            added_at: input.addedAt,
          })
          .executeTakeFirstOrThrow();
        const gameId = Number(result.insertId);
        await writeAliases(trx, gameId, input.aliases);
        return gameId;
      });
      const game = await get(id);
      if (!game) throw new Error("game vanished after insert");
      return game;
    },
    async update(id, patch) {
      await kysely.transaction().execute(async (trx) => {
        if (patch.name !== undefined) {
          await trx
            .updateTable("games")
            .set({ name: patch.name, normalized_name: normalize(patch.name) })
            .where("id", "=", id)
            .execute();
        }
        if (patch.categoryId !== undefined) {
          await trx
            .updateTable("games")
            .set({ category_id: patch.categoryId })
            .where("id", "=", id)
            .execute();
        }
        if (patch.aliases !== undefined) await writeAliases(trx, id, patch.aliases);
      });
      const game = await get(id);
      if (!game) throw new Error(`unknown game ${id}`);
      return game;
    },
    async remove(id) {
      await kysely.deleteFrom("games").where("id", "=", id).execute();
    },
    async ownsRole(roleId) {
      const row = await kysely
        .selectFrom("games")
        .select("id")
        .where("role_id", "=", roleId)
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
