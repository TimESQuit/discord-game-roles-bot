import { beforeEach, describe, expect, test } from "vitest";
import { UserFacingError } from "../errors.ts";
import type { Game } from "../db/index.ts";
import { addGame, editGame, reapplyTemplate, removeGame, sortGameRoles } from "./games.ts";
import {
  A1,
  defined,
  makeContext,
  TEMPLATE_COLOR,
  templatePosition,
  type TestContext,
} from "../testing/index.ts";

let ctx: TestContext;
let chill: { id: number };
let comp: { id: number };

beforeEach(async () => {
  ctx = await makeContext();
  const cats = await ctx.repos.categories.list();
  comp = defined(cats[0]);
  chill = defined(cats.find((c) => c.name === "Chill"));
});

const add = (name: string, aliases = ""): Promise<Game> =>
  addGame(ctx, { name, categoryId: chill.id, aliases, actorId: A1 });
const calls = (method: string) => ctx.gateway.calls.filter((c) => c.method === method);

describe("repeated add and remove", () => {
  test("six games added then removed leaves addGame working", async () => {
    const games: Game[] = [];
    for (let i = 0; i < 6; i++) games.push(await add(`Game ${i}`));
    for (const g of games) await removeGame(ctx, g.id, A1);
    await expect(add("Again")).resolves.toMatchObject({ name: "Again" });
  });
});

describe("stale IDs", () => {
  test("removing a removed game's ID again never touches a newer game", async () => {
    const old = await add("Old");
    await removeGame(ctx, old.id, A1);
    const fresh = await add("Fresh");
    expect(fresh.id).not.toBe(old.id);
    await expect(removeGame(ctx, old.id, A1)).rejects.toThrow("That game no longer exists.");
    expect(ctx.gateway.role(fresh.roleId)).toBeDefined();
    expect(await ctx.repos.games.get(fresh.id)).toBeDefined();
  });

  test("collision errors escape game names", async () => {
    await add("*Bold* Game");
    await expect(add("*bold* game")).rejects.toThrow(
      "There's already a game called \\*Bold\\* Game.",
    );
  });
});

describe("addGame", () => {
  test("copies template color + mentionable, stores the role, sorts, logs", async () => {
    const game = await add("Valheim", "vh");
    expect(ctx.gateway.role(game.roleId)).toMatchObject({
      name: "Valheim",
      color: TEMPLATE_COLOR,
      mentionable: true,
    });
    expect(await ctx.repos.games.ownsRole(game.roleId)).toBe(true);
    expect(game.aliases).toEqual(["vh"]);
    expect(ctx.logLines).toContain(`<@${A1}> added game **Valheim**`);
    expect(defined(ctx.gateway.role(game.roleId)).position).toBeLessThan(templatePosition + 1);
  });

  test("refuses a name or alias that collides with an existing game", async () => {
    await add("Valheim", "vh");
    await expect(add("valheim!")).rejects.toThrow("There's already a game called Valheim.");
    await expect(add("Other", "VH")).rejects.toThrow("The alias vh is already used by Valheim.");
    await expect(add("Other", "valheim")).rejects.toThrow(UserFacingError);
    await expect(add("vh")).rejects.toThrow(UserFacingError);
    expect(calls("createRole")).toHaveLength(1);
  });

  test("unknown category", async () => {
    await expect(
      addGame(ctx, { name: "X", categoryId: 9999, aliases: "", actorId: A1 }),
    ).rejects.toThrow("That category doesn't exist.");
  });

  test("bot below the template → exact fix, nothing created", async () => {
    ctx.gateway.setBotTopPosition(templatePosition - 1);
    await expect(add("Valheim")).rejects.toThrow(
      "Move the bot's role above Game role template in Server Settings → Roles",
    );
    expect(calls("createRole")).toHaveLength(0);
  });

  test("missing Manage Roles → exact fix", async () => {
    ctx.gateway.setMissingPermissions(["ManageRoles"]);
    await expect(add("Valheim")).rejects.toThrow(
      "Give the bot the Manage Roles permission in Server Settings → Roles.",
    );
    expect(calls("createRole")).toHaveLength(0);
  });

  test("no template recorded → 'Run /gameadmin setup first.'", async () => {
    const bare = await makeContext({ setup: false });
    await expect(
      addGame(bare, { name: "Valheim", categoryId: 1, aliases: "", actorId: A1 }),
    ).rejects.toThrow("Run /gameadmin setup first.");
  });

  test("Discord fails after createRole → the role is deleted again and no row is stored", async () => {
    ctx.gateway.failNext("setRolePositions", new Error("boom"));
    // Force a reorder so sortGameRoles has something to send.
    ctx.gateway.addRole({
      id: "100000000000000901",
      name: "Zed",
      position: 1,
      color: 0,
      mentionable: false,
    });
    await ctx.repos.games.add({
      name: "Zed",
      categoryId: chill.id,
      roleId: "100000000000000901",
      aliases: [],
      addedBy: A1,
      addedAt: "2026-01-01T00:00:00Z",
    });
    await expect(add("Alpha")).rejects.toThrow("boom");
    expect(await ctx.repos.games.byNormalizedName("Alpha")).toBeUndefined();
    expect(await ctx.repos.games.list()).toHaveLength(1);
    const created = calls("createRole").length;
    expect(created).toBe(1);
    expect(calls("deleteRole")).toHaveLength(1);
    expect(ctx.logLines).toHaveLength(0);
  });
});

describe("editGame", () => {
  test("rename renames the role, re-sorts and logs the change", async () => {
    await add("Zed");
    const g = await add("Alpha");
    const edited = await editGame(ctx, g.id, { name: "Zulu" }, A1);
    expect(edited.name).toBe("Zulu");
    expect(defined(ctx.gateway.role(g.roleId)).name).toBe("Zulu");
    expect(calls("setRolePositions").length).toBeGreaterThan(0);
    expect(ctx.logLines).toContain(`<@${A1}> edited game **Zulu**: renamed Alpha → Zulu`);
  });

  test("reports each changed part", async () => {
    const g = await add("Valheim");
    await editGame(ctx, g.id, { name: "Valheim 2", categoryId: comp.id, aliases: "vh, val" }, A1);
    const last = defined(ctx.logLines.at(-1));
    expect(last).toContain("renamed Valheim → Valheim 2; moved to Competitive; aliases: vh, val");
  });

  test("no-op patch → no Discord calls, no log line", async () => {
    const g = await add("Valheim", "vh");
    const before = ctx.gateway.calls.length;
    const logs = ctx.logLines.length;
    await editGame(ctx, g.id, { name: "Valheim", categoryId: chill.id, aliases: "vh" }, A1);
    expect(ctx.gateway.calls.length).toBe(before);
    expect(ctx.logLines).toHaveLength(logs);
  });

  test("category-only change needs no role permissions", async () => {
    const g = await add("Valheim");
    ctx.gateway.setMissingPermissions(["ManageRoles"]);
    const edited = await editGame(ctx, g.id, { categoryId: comp.id }, A1);
    expect(edited.categoryId).toBe(comp.id);
  });

  test("unknown game / category, and rename collision", async () => {
    const g = await add("Valheim");
    await add("Other");
    await expect(editGame(ctx, 9999, {}, A1)).rejects.toThrow("That game no longer exists.");
    await expect(editGame(ctx, g.id, { categoryId: 9999 }, A1)).rejects.toThrow(
      "That category doesn't exist.",
    );
    await expect(editGame(ctx, g.id, { name: "other" }, A1)).rejects.toThrow(
      "There's already a game called Other.",
    );
  });
});

describe("removeGame", () => {
  test("deletes only that game's role and its row", async () => {
    const valheim = await add("Valheim");
    const other = await ctx.gateway.createRole(
      { name: "Not ours", color: 0, mentionable: false },
      "t",
    );
    ctx.gateway.addMember("100000000000000001", [valheim.roleId]);
    const { game, hadMembers } = await removeGame(ctx, valheim.id, A1);
    const deleted = calls("deleteRole").map((c) => c.args[0]);
    expect(deleted).toEqual([game.roleId]);
    expect(hadMembers).toBe(1);
    expect(ctx.gateway.role(other.id)).toBeDefined();
    expect(await ctx.repos.games.get(valheim.id)).toBeUndefined();
    expect(ctx.logLines).toContain(`<@${A1}> removed game **Valheim**`);
  });

  test("when the role was already deleted by hand still removes the row", async () => {
    const valheim = await add("Valheim");
    ctx.gateway.removeRoleBehindBotsBack(valheim.roleId);
    await removeGame(ctx, valheim.id, A1);
    expect(await ctx.repos.games.get(valheim.id)).toBeUndefined();
    expect(calls("deleteRole")).toHaveLength(0);
  });

  test("unknown game", async () => {
    await expect(removeGame(ctx, 9999, A1)).rejects.toThrow("That game no longer exists.");
  });
});

describe("reapplyTemplate", () => {
  test("edits only game roles", async () => {
    const a = await add("Alpha");
    const b = await add("Beta");
    ctx.gateway.removeRoleBehindBotsBack(b.roleId);
    const other = await ctx.gateway.createRole(
      { name: "Not ours", color: 1, mentionable: false },
      "t",
    );
    await ctx.gateway.editRole(a.roleId, { color: 7, mentionable: false }, "t");
    const count = await reapplyTemplate(ctx, A1);
    expect(count).toBe(1);
    expect(ctx.gateway.role(a.roleId)).toMatchObject({ color: TEMPLATE_COLOR, mentionable: true });
    expect(ctx.gateway.role(other.id)).toMatchObject({ color: 1, mentionable: false });
    expect(ctx.logLines).toContain(`<@${A1}> reapplied the role template to 1 game roles`);
  });
});

describe("sortGameRoles", () => {
  test("makes no call when already sorted", async () => {
    await add("Alpha");
    await add("Beta");
    const before = calls("setRolePositions").length;
    await sortGameRoles(ctx);
    expect(calls("setRolePositions")).toHaveLength(before);
  });
});
