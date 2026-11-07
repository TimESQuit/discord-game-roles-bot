import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  `CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL);
CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id), role_id TEXT NOT NULL UNIQUE,
  added_by TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE game_aliases (game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  alias TEXT NOT NULL, PRIMARY KEY (game_id, alias));
CREATE TABLE setup (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get();
  const current = Number(row?.user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) continue;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}
