import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { MIGRATIONS_DIR, closeDatabase, openDatabase } from "../../src/db/database.ts";

test("openDatabase applies the generated migrations once", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "gr-")), "bot.sqlite");
  const first = openDatabase(path);
  await closeDatabase(first);
  expect(first.sqlite.open).toBe(false);
  const second = openDatabase(path);
  const applied = second.sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as {
    n: number;
  };
  expect(applied.n).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);
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
