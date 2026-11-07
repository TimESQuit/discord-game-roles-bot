import type { DatabaseSync } from "node:sqlite";
import { normalize } from "../domain/search.ts";
import type { Category, Game, SetupKey } from "./types.ts";

type Row = Record<string, unknown>;

export type CategoriesRepo = {
  list(): Category[];
  get(id: number): Category | undefined;
  add(name: string): Category;
  rename(id: number, name: string): void;
  move(id: number, dir: "up" | "down"): void;
};

export type GamesRepo = {
  list(): Game[];
  get(id: number): Game | undefined;
  byRoleId(roleId: string): Game | undefined;
  byNormalizedName(name: string): Game | undefined;
  add(input: Omit<Game, "id">): Game;
  update(id: number, patch: Partial<Pick<Game, "name" | "categoryId" | "aliases">>): Game;
  remove(id: number): void;
  ownsRole(roleId: string): boolean;
};

export type SetupRepo = {
  get(key: SetupKey): string | undefined;
  set(key: SetupKey, value: string): void;
  all(): Partial<Record<SetupKey, string>>;
};

// Task 6 adds `suggestions` and `lfg` here.
export type Repos = {
  categories: CategoriesRepo;
  games: GamesRepo;
  setup: SetupRepo;
};

function toCategory(row: Row): Category {
  return { id: Number(row.id), name: String(row.name), position: Number(row.position) };
}

function createCategories(db: DatabaseSync): CategoriesRepo {
  const get = (id: number): Category | undefined => {
    const row = db.prepare("SELECT id, name, position FROM categories WHERE id = ?").get(id);
    return row ? toCategory(row) : undefined;
  };
  return {
    list: () =>
      db
        .prepare("SELECT id, name, position FROM categories ORDER BY position, id")
        .all()
        .map(toCategory),
    get,
    add(name) {
      const max = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM categories").get();
      const result = db
        .prepare("INSERT INTO categories (name, position) VALUES (?, ?)")
        .run(name, Number(max?.m) + 1);
      return { id: Number(result.lastInsertRowid), name, position: Number(max?.m) + 1 };
    },
    rename(id, name) {
      db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, id);
    },
    move(id, dir) {
      const current = get(id);
      if (!current) return;
      const neighborSql =
        dir === "up"
          ? "SELECT id, name, position FROM categories WHERE position < ? ORDER BY position DESC LIMIT 1"
          : "SELECT id, name, position FROM categories WHERE position > ? ORDER BY position ASC LIMIT 1";
      const row = db.prepare(neighborSql).get(current.position);
      if (!row) return;
      const neighbor = toCategory(row);
      const setPosition = db.prepare("UPDATE categories SET position = ? WHERE id = ?");
      db.exec("BEGIN");
      try {
        setPosition.run(neighbor.position, current.id);
        setPosition.run(current.position, neighbor.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const GAME_COLUMNS = "id, name, category_id, role_id, added_by, added_at FROM games";

function createGames(db: DatabaseSync): GamesRepo {
  const aliasesOf = (gameId: number): string[] =>
    db
      .prepare("SELECT alias FROM game_aliases WHERE game_id = ? ORDER BY alias")
      .all(gameId)
      .map((r) => String(r.alias));

  const toGame = (row: Row): Game => ({
    id: Number(row.id),
    name: String(row.name),
    categoryId: Number(row.category_id),
    roleId: String(row.role_id),
    aliases: aliasesOf(Number(row.id)),
    addedBy: String(row.added_by),
    addedAt: String(row.added_at),
  });

  const one = (where: string, value: string | number): Game | undefined => {
    const row = db.prepare(`SELECT ${GAME_COLUMNS} WHERE ${where} = ?`).get(value);
    return row ? toGame(row) : undefined;
  };

  const writeAliases = (gameId: number, aliases: string[]): void => {
    db.prepare("DELETE FROM game_aliases WHERE game_id = ?").run(gameId);
    const insert = db.prepare("INSERT OR IGNORE INTO game_aliases (game_id, alias) VALUES (?, ?)");
    for (const alias of aliases) {
      const normalized = normalize(alias);
      if (normalized !== "") insert.run(gameId, normalized);
    }
  };

  const inTransaction = <T>(fn: () => T): T => {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const get = (id: number): Game | undefined => one("id", id);

  return {
    list: () => db.prepare(`SELECT ${GAME_COLUMNS} ORDER BY normalized_name`).all().map(toGame),
    get,
    byRoleId: (roleId) => one("role_id", roleId),
    byNormalizedName: (name) => one("normalized_name", normalize(name)),
    add(input) {
      const id = inTransaction(() => {
        const result = db
          .prepare(
            "INSERT INTO games (name, normalized_name, category_id, role_id, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            input.name,
            normalize(input.name),
            input.categoryId,
            input.roleId,
            input.addedBy,
            input.addedAt,
          );
        const gameId = Number(result.lastInsertRowid);
        writeAliases(gameId, input.aliases);
        return gameId;
      });
      const game = get(id);
      if (!game) throw new Error("game vanished after insert");
      return game;
    },
    update(id, patch) {
      inTransaction(() => {
        if (patch.name !== undefined) {
          db.prepare("UPDATE games SET name = ?, normalized_name = ? WHERE id = ?").run(
            patch.name,
            normalize(patch.name),
            id,
          );
        }
        if (patch.categoryId !== undefined) {
          db.prepare("UPDATE games SET category_id = ? WHERE id = ?").run(patch.categoryId, id);
        }
        if (patch.aliases !== undefined) writeAliases(id, patch.aliases);
      });
      const game = get(id);
      if (!game) throw new Error(`unknown game ${id}`);
      return game;
    },
    remove(id) {
      db.prepare("DELETE FROM games WHERE id = ?").run(id);
    },
    ownsRole: (roleId) =>
      db.prepare("SELECT 1 AS x FROM games WHERE role_id = ?").get(roleId) !== undefined,
  };
}

function createSetup(db: DatabaseSync): SetupRepo {
  return {
    get(key) {
      const row = db.prepare("SELECT value FROM setup WHERE key = ?").get(key);
      return row ? String(row.value) : undefined;
    },
    set(key, value) {
      db.prepare(
        "INSERT INTO setup (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, value);
    },
    all() {
      const result: Partial<Record<SetupKey, string>> = {};
      for (const row of db.prepare("SELECT key, value FROM setup").all()) {
        result[String(row.key) as SetupKey] = String(row.value);
      }
      return result;
    },
  };
}

export function createRepos(db: DatabaseSync): Repos {
  return {
    categories: createCategories(db),
    games: createGames(db),
    setup: createSetup(db),
  };
}
