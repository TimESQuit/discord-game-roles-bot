import { beforeEach, describe, expect, test } from "vitest";
import { UserFacingError } from "../errors.ts";
import type { Game } from "../db/index.ts";
import { addGame, removeGame } from "./games.ts";
import {
  applySelection,
  autocompleteGames,
  gamesInCommon,
  gamesOf,
  join,
  leave,
  whoPlays,
} from "./membership.ts";
import { A1, U1, U2, U3, makeContext } from "../testing/index.ts";
import type { TestContext } from "../testing/index.ts";

let ctx: TestContext;
let valheim: Game;
let minecraft: Game;
let chess: Game;

beforeEach(async () => {
  ctx = await makeContext();
  const cats = await ctx.repos.categories.list();
  const mk = (name: string, i: number) =>
    addGame(ctx, { name, categoryId: cats[i]!.id, aliases: "", actorId: A1 });
  valheim = await mk("Valheim", 1);
  minecraft = await mk("Minecraft", 1);
  chess = await mk("Chess", 0);
  ctx.gateway.messages.clear();
});

const names = (games: Game[]) => games.map((g) => g.name);

describe("applySelection", () => {
  test("changes only the shown dropdown's games and logs each change", async () => {
    ctx.gateway.addMember(U1, [valheim.roleId, chess.roleId]);
    const r = await applySelection(
      ctx,
      U1,
      [valheim.id, minecraft.id],
      [String(minecraft.id)],
      "panel",
    );
    expect(names(r.added)).toEqual(["Minecraft"]);
    expect(names(r.removed)).toEqual(["Valheim"]);
    expect(ctx.gateway.memberRoleIds(U1).has(chess.roleId)).toBe(true);
    expect(ctx.logLines).toEqual([
      `<@${U1}> joined **Minecraft** (panel)`,
      `<@${U1}> left **Valheim** (panel)`,
    ]);
  });

  test("a game removed since the menu opened is ignored", async () => {
    ctx.gateway.addMember(U1, []);
    await removeGame(ctx, valheim.id, A1);
    const r = await applySelection(
      ctx,
      U1,
      [valheim.id, minecraft.id],
      [String(valheim.id), String(minecraft.id)],
      "panel",
    );
    expect(names(r.added)).toEqual(["Minecraft"]);
    expect(r.missing).toEqual([]);
  });

  test("ignores non-numeric values and games that were not shown", async () => {
    ctx.gateway.addMember(U1, []);
    const r = await applySelection(
      ctx,
      U1,
      [minecraft.id],
      ["abc", String(chess.id), String(minecraft.id)],
      "panel",
    );
    expect(names(r.added)).toEqual(["Minecraft"]);
    expect(ctx.gateway.memberRoleIds(U1).has(chess.roleId)).toBe(false);
  });

  test("a role deleted by hand is reported missing, admins notified once, others applied", async () => {
    ctx.gateway.addMember(U1, []);
    ctx.gateway.removeRoleBehindBotsBack(valheim.roleId);
    const r = await applySelection(
      ctx,
      U1,
      [valheim.id, minecraft.id],
      [String(valheim.id), String(minecraft.id)],
      "panel",
    );
    expect(names(r.missing)).toEqual(["Valheim"]);
    expect(names(r.added)).toEqual(["Minecraft"]);
    expect(ctx.adminNotices).toEqual([
      "These games' roles are missing in Discord: Valheim. Remove the games or recreate them.",
    ]);
  });
});

test("an uncached member submitting an empty selection removes nothing and logs nothing", async () => {
  const r = await applySelection(ctx, U1, [valheim.id, minecraft.id], [], "panel");
  expect(r.removed).toEqual([]);
  expect(r.added).toEqual([]);
  expect(ctx.logLines).toEqual([]);
});

describe("join and leave", () => {
  test("join twice gives 'already' and one log line", async () => {
    ctx.gateway.addMember(U1, []);
    expect(await join(ctx, U1, valheim.id, "command")).toBe("joined");
    expect(await join(ctx, U1, valheim.id, "command")).toBe("already");
    expect(ctx.logLines).toEqual([`<@${U1}> joined **Valheim** (command)`]);
  });

  test("leave when not a member writes nothing; leave works otherwise", async () => {
    ctx.gateway.addMember(U1, [valheim.roleId]);
    expect(await leave(ctx, U1, minecraft.id, "lfg")).toBe("not-member");
    expect(ctx.logLines).toEqual([]);
    expect(await leave(ctx, U1, valheim.id, "lfg")).toBe("left");
    expect(ctx.logLines).toEqual([`<@${U1}> left **Valheim** (LFG post)`]);
  });

  test("unknown game", async () => {
    await expect(join(ctx, U1, 9999, "panel")).rejects.toThrow("That game no longer exists.");
    await expect(leave(ctx, U1, 9999, "panel")).rejects.toThrow(UserFacingError);
  });

  test("join on a missing role notifies admins and throws", async () => {
    ctx.gateway.removeRoleBehindBotsBack(valheim.roleId);
    await expect(join(ctx, U1, valheim.id, "panel")).rejects.toThrow(
      "That game's role is missing; the admins have been told.",
    );
    expect(ctx.adminNotices.some((n) => n.includes("Valheim"))).toBe(true);
    expect(ctx.logLines).toEqual([]);
  });
});

describe("lookups", () => {
  beforeEach(() => {
    ctx.gateway.addMember(U1, [valheim.roleId, chess.roleId]);
    ctx.gateway.addMember(U2, [chess.roleId, minecraft.roleId]);
    ctx.gateway.addMember(U3, [chess.roleId]);
  });

  test("gamesOf and whoPlays", async () => {
    expect(names(await gamesOf(ctx, U1))).toEqual(["Chess", "Valheim"]);
    expect((await whoPlays(ctx, chess.id)).toSorted()).toEqual([U1, U2, U3]);
    expect(await whoPlays(ctx, 9999)).toEqual([]);
  });

  test("gamesInCommon", async () => {
    expect(names(await gamesInCommon(ctx, U1, U2))).toEqual(["Chess"]);
    expect(await gamesInCommon(ctx, U1, "100000000000000099")).toEqual([]);
  });

  test("autocomplete add hides owned; remove shows only owned; empty add = most members first", async () => {
    expect(names(await autocompleteGames(ctx, U1, "", "add"))).toEqual(["Minecraft"]);
    expect(names(await autocompleteGames(ctx, U1, "", "remove"))).toEqual(["Chess", "Valheim"]);
    expect(names(await autocompleteGames(ctx, "100000000000000099", "", "add"))).toEqual([
      "Chess",
      "Minecraft",
      "Valheim",
    ]);
    expect(names(await autocompleteGames(ctx, U3, "", "add"))).toEqual(["Minecraft", "Valheim"]);
    expect(names(await autocompleteGames(ctx, U1, "val", "any"))).toEqual(["Valheim"]);
    expect(names(await autocompleteGames(ctx, U1, "", "any"))).toEqual([
      "Chess",
      "Minecraft",
      "Valheim",
    ]);
  });

  test("empty add query orders by member count, not by name", async () => {
    // Valheim sorts last alphabetically but is the most popular; Minecraft and Chess tie lower.
    ctx.gateway.addMember(U2, [valheim.roleId, minecraft.roleId]);
    ctx.gateway.addMember(U3, [valheim.roleId]);
    ctx.gateway.addMember(U1, [valheim.roleId]);
    const outsider = "100000000000000098";
    expect(names(await autocompleteGames(ctx, outsider, "", "add"))).toEqual([
      "Valheim",
      "Minecraft",
      "Chess",
    ]);
  });

  test("autocomplete returns at most 25", async () => {
    const cat = (await ctx.repos.categories.list())[0]!;
    for (let i = 0; i < 30; i++) {
      await addGame(ctx, { name: `Extra ${i}`, categoryId: cat.id, aliases: "", actorId: A1 });
    }
    expect(await autocompleteGames(ctx, U1, "", "any")).toHaveLength(25);
  });
});
