import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { closeDatabase, openDatabase, type Db } from "../db/database.ts";
import { createRepos } from "../db/repos/index.ts";
import { UserFacingError } from "../errors.ts";
import { runBackup, scheduleNightlyBackups } from "./backup.ts";
import { createAudit } from "./audit.ts";
import { A1, makeContext, sentTo, type TestContext } from "../testing/context.ts";

let ctx: TestContext;
let dir: string;
let fileDb: Db;

// The fake gateway stamps new posts around 2023-11-14, so the tests run "now" just after that.
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "backup-test-"));
  ctx = await makeContext({ now: new Date("2023-11-15T04:05:00Z") });
  fileDb = openDatabase(join(dir, "live.sqlite"));
  // Use a file-backed DB for the services under test, with matching repos.
  ctx.repos = createRepos(fileDb.kysely);
  ctx.audit = createAudit(ctx.repos, ctx.gateway);
  for (const key of ["backupsChannelId", "logChannelId", "adminChannelId"] as const) {
    const id = (
      await ctx.db.kysely
        .selectFrom("setup")
        .select("value")
        .where("key", "=", key)
        .executeTakeFirstOrThrow()
    ).value;
    await ctx.repos.setup.set(key, id);
  }
});
afterEach(async () => {
  vi.useRealTimers();
  await closeDatabase(fileDb);
  rmSync(dir, { recursive: true, force: true });
});

const backupsId = async () => (await ctx.repos.setup.get("backupsChannelId"))!;
const bytes = (a: unknown): Buffer => a as Buffer;

test("runBackup posts a readable copy named game-roles-YYYY-MM-DD-HHmm.sqlite and prunes old posts", async () => {
  const cat = (await ctx.repos.categories.add("Chill")) as { id: number };
  await ctx.repos.games.add({
    name: "Valheim",
    categoryId: cat.id,
    roleId: "100000000000000900",
    aliases: [],
    addedBy: A1,
    addedAt: "2026-11-01T00:00:00Z",
  });
  const channel = await backupsId();
  const old = ctx.gateway.addOwnMessage(channel, {
    createdAt: new Date("2023-09-01T00:00:00Z"),
    hasAttachment: true,
  });
  const recent = ctx.gateway.addOwnMessage(channel, {
    createdAt: new Date("2023-11-01T00:00:00Z"),
    hasAttachment: true,
  });

  const result = await runBackup(ctx, fileDb, null);

  expect(result).toEqual({ file: "game-roles-2023-11-15-0405.sqlite", pruned: 1 });
  const ids = (ctx.gateway.messages.get(channel) ?? []).map((m) => m.id);
  expect(ids).not.toContain(old);
  expect(ids).toContain(recent);
  const sent = sentTo(ctx, "backupsChannelId").at(-1)!;
  expect(sent.content).toBe("Nightly backup");
  expect(sent.allowedMentions).toEqual({ parse: [] });
  const file = sent.files![0] as { attachment: unknown; name: string };
  expect(file.name).toBe(result.file);

  const copy = join(dir, "copy.sqlite");
  writeFileSync(copy, bytes(file.attachment));
  const sqlite = new BetterSqlite3(copy, { readonly: true });
  expect(sqlite.prepare("SELECT name FROM games").all()).toEqual([{ name: "Valheim" }]);
  sqlite.close();
  expect(ctx.logLines.at(-1)).toBe("Automatic backup saved: game-roles-2023-11-15-0405.sqlite");
});

test("manual backup mentions nobody and logs the actor", async () => {
  await runBackup(ctx, fileDb, A1);
  const sent = sentTo(ctx, "backupsChannelId").at(-1)!;
  expect(sent.content).toBe(`Backup requested by <@${A1}>`);
  expect(ctx.logLines.at(-1)).toContain(`<@${A1}> created backup`);
});

test("runBackup without a backups channel asks for setup", async () => {
  const bare = await makeContext({ setup: false });
  await expect(runBackup(bare, bare.db, null)).rejects.toThrow(UserFacingError);
  await expect(runBackup(bare, bare.db, null)).rejects.toThrow("Run /gameadmin setup first.");
  await closeDatabase(bare.db);
});

test("send failure throws; pruning failure only notifies admins", async () => {
  ctx.gateway.failNext("send", new Error("boom"));
  await expect(runBackup(ctx, fileDb, null)).rejects.toThrow("boom");

  const channel = await backupsId();
  ctx.gateway.addOwnMessage(channel, {
    createdAt: new Date("2023-09-01T00:00:00Z"),
    hasAttachment: true,
  });
  ctx.gateway.failNext("deleteMessage", new Error("nope"));
  const result = await runBackup(ctx, fileDb, null);
  expect(result.pruned).toBe(0);
  expect(ctx.adminNotices.join("\n")).toContain("nope");
});

test("scheduleNightlyBackups runs at the configured hour, reports failures, reschedules, cancels", async () => {
  const realTimeout = globalThis.setTimeout;
  // Only timeouts and the clock are faked, so the real file I/O of a backup can finish.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2023-11-15T03:00:00Z"));
  ctx.now = () => new Date();
  const realSleep = (ms: number): Promise<void> => new Promise((r) => realTimeout(r, ms));
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await realSleep(10);
  };
  const advance = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  };
  const backups = (): number =>
    ctx.gateway.calls.filter((c) => c.method === "send" && (c.args[1] as { files?: unknown }).files)
      .length;

  const cancel = scheduleNightlyBackups(ctx, fileDb);
  await advance(3_600_000 - 1);
  expect(backups()).toBe(0);
  ctx.gateway.failNext("send", new Error("disk full"));
  await advance(1);
  expect(backups()).toBe(0);
  expect(ctx.adminNotices).toContain("Nightly backup failed: disk full");
  await advance(24 * 3_600_000);
  expect(backups()).toBe(1);
  cancel();
  await advance(48 * 3_600_000);
  expect(backups()).toBe(1);
});
