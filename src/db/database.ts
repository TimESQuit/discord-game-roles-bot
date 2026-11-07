import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  `CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL);
CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id), role_id TEXT NOT NULL UNIQUE,
  added_by TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE game_aliases (game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  alias TEXT NOT NULL, PRIMARY KEY (game_id, alias));
CREATE TABLE setup (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `CREATE TABLE suggestions (id INTEGER PRIMARY KEY, suggester_id TEXT NOT NULL, name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id), note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewer_id TEXT, rejection_reason TEXT, decided_at TEXT, created_at TEXT NOT NULL,
  review_message_id TEXT, game_id INTEGER REFERENCES games(id) ON DELETE SET NULL);
CREATE INDEX suggestions_by_user ON suggestions(suggester_id, status);
CREATE TABLE lfg_posts (message_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL, game_name TEXT NOT NULL,
  author_id TEXT NOT NULL, "when" TEXT, note TEXT, created_at TEXT NOT NULL);
CREATE TABLE lfg_responses (message_id TEXT NOT NULL REFERENCES lfg_posts(message_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('in', 'maybe')), responded_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id));`,
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
