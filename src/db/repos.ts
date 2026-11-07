import type { DatabaseSync } from "node:sqlite";
import { normalize } from "../domain/search.ts";
import type { Category, Game, LfgPost, SetupKey, Suggestion, SuggestionStatus } from "./types.ts";

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

export type SuggestionsRepo = {
  add(
    input: Pick<Suggestion, "suggesterId" | "name" | "categoryId" | "note" | "createdAt">,
  ): Suggestion;
  get(id: number): Suggestion | undefined;
  listByUser(userId: string): Suggestion[];
  listPending(): Suggestion[];
  countPending(userId: string): number;
  pendingNames(): { id: number; name: string }[];
  decide(
    id: number,
    to: Exclude<SuggestionStatus, "pending">,
    by: string,
    at: string,
    reason?: string,
  ): boolean;
  undoDecision(id: number): void;
  update(id: number, patch: Partial<Pick<Suggestion, "name" | "categoryId" | "note">>): void;
  setReviewMessage(id: number, messageId: string): void;
  setGame(id: number, gameId: number | null): void;
};

export type LfgRepo = {
  add(post: Omit<LfgPost, "in" | "maybe">): void;
  get(messageId: string): LfgPost | undefined;
  setResponse(messageId: string, userId: string, kind: "in" | "maybe" | null): void;
};

export type Repos = {
  categories: CategoriesRepo;
  games: GamesRepo;
  setup: SetupRepo;
  suggestions: SuggestionsRepo;
  lfg: LfgRepo;
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

const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const SUGGESTION_SELECT =
  "SELECT id, suggester_id, name, category_id, note, status, reviewer_id, rejection_reason, decided_at, created_at, review_message_id, game_id FROM suggestions";

function toSuggestion(row: Row): Suggestion {
  return {
    id: Number(row.id),
    suggesterId: String(row.suggester_id),
    name: String(row.name),
    categoryId: Number(row.category_id),
    note: nullable(row.note),
    status: String(row.status) as SuggestionStatus,
    reviewerId: nullable(row.reviewer_id),
    rejectionReason: nullable(row.rejection_reason),
    decidedAt: nullable(row.decided_at),
    createdAt: String(row.created_at),
    reviewMessageId: nullable(row.review_message_id),
    gameId: row.game_id === null || row.game_id === undefined ? null : Number(row.game_id),
  };
}

function createSuggestions(db: DatabaseSync): SuggestionsRepo {
  const get = (id: number): Suggestion | undefined => {
    const row = db.prepare(`${SUGGESTION_SELECT} WHERE id = ?`).get(id);
    return row ? toSuggestion(row) : undefined;
  };
  return {
    add(input) {
      const result = db
        .prepare(
          "INSERT INTO suggestions (suggester_id, name, category_id, note, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(input.suggesterId, input.name, input.categoryId, input.note, input.createdAt);
      const created = get(Number(result.lastInsertRowid));
      if (!created) throw new Error("suggestion vanished after insert");
      return created;
    },
    get,
    listByUser: (userId) =>
      db
        .prepare(`${SUGGESTION_SELECT} WHERE suggester_id = ? ORDER BY created_at DESC, id DESC`)
        .all(userId)
        .map(toSuggestion),
    listPending: () =>
      db
        .prepare(`${SUGGESTION_SELECT} WHERE status = 'pending' ORDER BY created_at, id`)
        .all()
        .map(toSuggestion),
    countPending(userId) {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM suggestions WHERE suggester_id = ? AND status = 'pending'",
        )
        .get(userId);
      return Number(row?.n ?? 0);
    },
    pendingNames: () =>
      db
        .prepare(
          "SELECT id, name FROM suggestions WHERE status = 'pending' ORDER BY created_at, id",
        )
        .all()
        .map((row) => ({ id: Number(row.id), name: String(row.name) })),
    decide(id, to, by, at, reason) {
      const result = db
        .prepare(
          "UPDATE suggestions SET status = ?, reviewer_id = ?, rejection_reason = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(to, by, to === "rejected" ? (reason ?? null) : null, at, id);
      return Number(result.changes) > 0;
    },
    undoDecision(id) {
      db.prepare(
        "UPDATE suggestions SET status = 'pending', reviewer_id = NULL, rejection_reason = NULL, decided_at = NULL WHERE id = ?",
      ).run(id);
    },
    update(id, patch) {
      if (patch.name !== undefined) {
        db.prepare("UPDATE suggestions SET name = ? WHERE id = ?").run(patch.name, id);
      }
      if (patch.categoryId !== undefined) {
        db.prepare("UPDATE suggestions SET category_id = ? WHERE id = ?").run(patch.categoryId, id);
      }
      if (patch.note !== undefined) {
        db.prepare("UPDATE suggestions SET note = ? WHERE id = ?").run(patch.note, id);
      }
    },
    setReviewMessage(id, messageId) {
      db.prepare("UPDATE suggestions SET review_message_id = ? WHERE id = ?").run(messageId, id);
    },
    setGame(id, gameId) {
      db.prepare("UPDATE suggestions SET game_id = ? WHERE id = ?").run(gameId, id);
    },
  };
}

function createLfg(db: DatabaseSync): LfgRepo {
  const usersOf = (messageId: string, kind: "in" | "maybe"): string[] =>
    db
      .prepare(
        "SELECT user_id FROM lfg_responses WHERE message_id = ? AND kind = ? ORDER BY responded_at, rowid",
      )
      .all(messageId, kind)
      .map((row) => String(row.user_id));
  return {
    add(post) {
      db.prepare(
        'INSERT INTO lfg_posts (message_id, channel_id, game_id, game_name, author_id, "when", note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        post.messageId,
        post.channelId,
        post.gameId,
        post.gameName,
        post.authorId,
        post.when,
        post.note,
        post.createdAt,
      );
    },
    get(messageId) {
      const row = db
        .prepare(
          'SELECT message_id, channel_id, game_id, game_name, author_id, "when", note, created_at FROM lfg_posts WHERE message_id = ?',
        )
        .get(messageId);
      if (!row) return undefined;
      return {
        messageId: String(row.message_id),
        channelId: String(row.channel_id),
        gameId: row.game_id === null ? null : Number(row.game_id),
        gameName: String(row.game_name),
        authorId: String(row.author_id),
        when: nullable(row.when),
        note: nullable(row.note),
        createdAt: String(row.created_at),
        in: usersOf(messageId, "in"),
        maybe: usersOf(messageId, "maybe"),
      };
    },
    setResponse(messageId, userId, kind) {
      if (kind === null) {
        db.prepare("DELETE FROM lfg_responses WHERE message_id = ? AND user_id = ?").run(
          messageId,
          userId,
        );
        return;
      }
      db.prepare(
        `INSERT INTO lfg_responses (message_id, user_id, kind, responded_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET kind = excluded.kind, responded_at = excluded.responded_at
         WHERE kind != excluded.kind`,
      ).run(messageId, userId, kind, new Date().toISOString());
    },
  };
}

export function createRepos(db: DatabaseSync): Repos {
  return {
    categories: createCategories(db),
    games: createGames(db),
    setup: createSetup(db),
    suggestions: createSuggestions(db),
    lfg: createLfg(db),
  };
}
