import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { MIGRATIONS_DIR, clearData, closeDatabase, openDatabase } from "./database.ts";
import { createRepos } from "./repos/index.ts";

test("openDatabase applies the generated migrations once", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "gr-")), "bot.sqlite");
  const first = openDatabase(path);
  await closeDatabase(first);
  expect(first.sqlite.open).toBe(false);
  const second = openDatabase(path);
  const applied = second.sqlite
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM __drizzle_migrations")
    .get();
  expect(applied).toBeDefined();
  expect(applied?.n).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);
  await closeDatabase(second);
});

test("foreign keys are enforced", async () => {
  const db = openDatabase(":memory:");
  await expect(
    db.kysely
      .insertInto("games")
      .values({
        name: "Valheim",
        normalized_name: "valheim",
        category_id: 999,
        role_id: "200000000000000001",
        added_by: "100000000000000001",
        added_at: "2026-01-01T00:00:00.000Z",
      })
      .execute(),
  ).rejects.toThrow(/FOREIGN KEY/);
  await closeDatabase(db);
});

test("closeDatabase closes a database that never ran a query", async () => {
  const db = openDatabase(":memory:");
  await closeDatabase(db);
  expect(db.sqlite.open).toBe(false);
});

test("clearData empties every table but keeps the migration history", async () => {
  const db = openDatabase(":memory:");
  const repos = createRepos(db.kysely);
  const { id: categoryId } = await repos.categories.add("Chill");
  await repos.games.add({
    name: "Valheim",
    categoryId,
    roleId: "100000000000000001",
    aliases: ["vh"],
    addedBy: "100000000000000002",
    addedAt: "2026-01-01T00:00:00Z",
  });
  await repos.setup.set("logChannelId", "100000000000000003");

  clearData(db);

  const tables = db.sqlite
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((t) => t.name);
  for (const table of tables) {
    const { n } = db.sqlite
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`)
      .get() ?? { n: -1 };
    expect({ table, empty: n === 0 }).toEqual({
      table,
      empty: table !== "__drizzle_migrations",
    });
  }
  await closeDatabase(db);
});
