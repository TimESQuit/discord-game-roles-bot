import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, test } from "vitest";
import { MIGRATIONS_DIR, closeDatabase, openDatabase } from "./database.ts";
import { createRepos } from "./repos/index.ts";

const U = "100000000000000001";

test("a removed game's ID is never handed to the next game", async () => {
  const db = openDatabase(":memory:");
  const repos = createRepos(db.kysely);
  const cat = await repos.categories.add("Chill");
  const add = (name: string, roleId: string) =>
    repos.games.add({
      name,
      categoryId: cat.id,
      roleId,
      aliases: [],
      addedBy: U,
      addedAt: "2026-01-01T00:00:00Z",
    });
  const first = await add("One", "200000000000000001");
  await repos.games.remove(first.id);
  const second = await add("Two", "200000000000000002");
  expect(second.id).not.toBe(first.id);
  await closeDatabase(db);
});

test("a removed category's ID is never handed to the next category", async () => {
  const db = openDatabase(":memory:");
  const first = await db.kysely
    .insertInto("categories")
    .values({ name: "A", position: 0 })
    .executeTakeFirstOrThrow();
  await db.kysely.deleteFrom("categories").execute();
  const repos = createRepos(db.kysely);
  const next = await repos.categories.add("B");
  expect(next.id).not.toBe(Number(first.insertId));
  await closeDatabase(db);
});

test("a removed suggestion's ID is never handed to the next suggestion", async () => {
  const db = openDatabase(":memory:");
  const repos = createRepos(db.kysely);
  const cat = await repos.categories.add("Chill");
  const input = {
    suggesterId: U,
    name: "X",
    categoryId: cat.id,
    note: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const first = await repos.suggestions.add(input);
  await repos.suggestions.remove(first.id);
  const second = await repos.suggestions.add(input);
  expect(second.id).not.toBe(first.id);
  await closeDatabase(db);
});

test("upgrading from the previous migration keeps every row and foreign key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gr-up-"));
  const old = join(dir, "old");
  cpSync(MIGRATIONS_DIR, old, { recursive: true });
  const journalPath = join(old, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, 2);
  writeFileSync(journalPath, JSON.stringify(journal));

  const path = join(dir, "bot.sqlite");
  const raw = new BetterSqlite3(path);
  raw.pragma("foreign_keys = OFF");
  migrate(drizzle(raw), { migrationsFolder: old });
  raw.exec(`
    INSERT INTO categories (id, name, position) VALUES (1, 'Chill', 0), (2, 'Comp', 1);
    INSERT INTO games (id, name, normalized_name, category_id, role_id, added_by, added_at)
      VALUES (1, 'One', 'one', 1, '200000000000000001', '${U}', 'x'),
             (2, 'Two', 'two', 2, '200000000000000002', '${U}', 'x');
    INSERT INTO game_aliases (game_id, alias) VALUES (1, 'uno'), (2, 'dos');
    INSERT INTO suggestions (id, suggester_id, name, category_id, status, created_at, game_id, aliases)
      VALUES (1, '${U}', 'S1', 1, 'approved', 'x', 1, 'a'), (2, '${U}', 'S2', 2, 'pending', 'x', NULL, NULL);
    INSERT INTO lfg_posts (message_id, channel_id, game_id, game_name, author_id, created_at)
      VALUES ('300000000000000001', '300000000000000002', 2, 'Two', '${U}', 'x');
    INSERT INTO lfg_responses (message_id, user_id, kind, responded_at)
      VALUES ('300000000000000001', '${U}', 'in', 'x');
    INSERT INTO setup (key, value) VALUES ('templateRoleId', '1');
  `);
  raw.close();

  const db = openDatabase(path);
  const count = (table: string) =>
    (db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  expect(count("categories")).toBe(2);
  expect(count("games")).toBe(2);
  expect(count("game_aliases")).toBe(2);
  expect(count("suggestions")).toBe(2);
  expect(count("lfg_posts")).toBe(1);
  expect(count("lfg_responses")).toBe(1);
  expect(count("setup")).toBe(1);
  expect(db.sqlite.pragma("foreign_key_check")).toEqual([]);
  expect(db.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.sqlite.prepare("SELECT game_id FROM suggestions WHERE id = 1").get()).toEqual({
    game_id: 1,
  });

  // The foreign keys still work: ON DELETE SET NULL / CASCADE.
  db.sqlite.prepare("DELETE FROM games WHERE id = 1").run();
  expect(db.sqlite.prepare("SELECT game_id FROM suggestions WHERE id = 1").get()).toEqual({
    game_id: null,
  });
  expect(count("game_aliases")).toBe(1);
  expect(() => db.sqlite.prepare("DELETE FROM categories WHERE id = 2").run()).toThrow(
    /FOREIGN KEY/,
  );
  expect(() =>
    db.sqlite
      .prepare(
        "INSERT INTO suggestions (suggester_id, name, category_id, status, created_at) VALUES ('1','n',1,'bogus','x')",
      )
      .run(),
  ).toThrow(/CHECK/);
  await closeDatabase(db);
});
