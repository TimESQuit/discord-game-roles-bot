import { describe, expect, test } from "vitest";

import { UserFacingError } from "../errors.ts";
import { A1, TEMPLATE_ROLE_ID, U1, U2, U3, defined, makeContext } from "../testing/index.ts";
import { addGame } from "./games.ts";
import { applyUninstall, leaveServer, previewUninstall } from "./uninstall.ts";

import type { SetupKey } from "../db/index.ts";
import type { UninstallOption, UninstallResult } from "../domain/index.ts";
import type { TestContext } from "../testing/index.ts";

const OUTSIDE = "100000000000009999";

async function seeded(): Promise<TestContext & { roleIds: string[] }> {
  const ctx = await makeContext();
  const chill = defined((await ctx.repos.categories.list())[0]);
  const roleIds: string[] = [];
  for (const name of ["Valheim", "Factorio"]) {
    const game = await addGame(ctx, { name, categoryId: chill.id, aliases: "", actorId: A1 });
    roleIds.push(game.roleId);
  }
  ctx.gateway.addMember(U1, roleIds);
  ctx.gateway.addMember(U2, [defined(roleIds[0])]);
  ctx.gateway.addMember(U3, []);
  ctx.gateway.calls = [];
  return Object.assign(ctx, { roleIds });
}

const id = async (ctx: TestContext, key: SetupKey): Promise<string> =>
  defined(await ctx.repos.setup.get(key));

const deleted = (ctx: TestContext, method: "deleteRole" | "deleteChannel"): string[] =>
  ctx.gateway.calls.flatMap((c) => (c.method === method ? [c.args[0]] : []));

const run = (
  ctx: TestContext,
  keep: UninstallOption[] = [],
  from = OUTSIDE,
  deliver: (result: UninstallResult) => Promise<void> = async () => {},
) => applyUninstall(ctx, A1, new Set(keep), from, deliver);

const MEMBER_KEYS = ["panelChannelId", "newsChannelId"] as const;
const ADMIN_KEYS = ["adminChannelId", "logChannelId", "backupsChannelId"] as const;

describe("previewUninstall", () => {
  test("counts game roles, the members holding them, and each channel group", async () => {
    const ctx = await seeded();
    expect(await previewUninstall(ctx, OUTSIDE)).toEqual({
      gameRoles: 2,
      members: 2,
      memberChannels: 2,
      adminChannels: 3,
      here: null,
    });
  });

  test("says which group the command was run from", async () => {
    const ctx = await seeded();
    expect((await previewUninstall(ctx, await id(ctx, "newsChannelId"))).here).toBe("member");
    expect((await previewUninstall(ctx, await id(ctx, "logChannelId"))).here).toBe("admin");
  });

  test("channels already deleted by hand aren't counted", async () => {
    const ctx = await seeded();
    ctx.gateway.deleteChannelBehindBotsBack(await id(ctx, "newsChannelId"));
    expect((await previewUninstall(ctx, OUTSIDE)).memberChannels).toBe(1);
  });
});

describe("applyUninstall", () => {
  test("keeping nothing deletes every role and channel, then wipes the data", async () => {
    const ctx = await seeded();
    const channels = await Promise.all(
      [...MEMBER_KEYS, ...ADMIN_KEYS, "adminCategoryId" as const].map((k) => id(ctx, k)),
    );

    const result = await run(ctx);

    expect(deleted(ctx, "deleteRole").toSorted()).toEqual(
      [...ctx.roleIds, TEMPLATE_ROLE_ID].toSorted(),
    );
    expect(deleted(ctx, "deleteChannel")).toEqual(channels);
    expect(result).toMatchObject({ deletedRoles: 3, deletedChannels: 6 });
    expect(result.backup.name).toMatch(/\.sqlite$/);
    expect(result.backup.attachment.length).toBeGreaterThan(0);
    expect(await ctx.repos.setup.all()).toEqual({});
    expect(await ctx.repos.games.list()).toEqual([]);
    expect(await ctx.repos.categories.list()).toEqual([]);
  });

  test("never clears commands or leaves; that is leaveServer's job", async () => {
    const ctx = await seeded();
    await run(ctx, ["leave"]);
    expect(
      ctx.gateway.calls.some((c) => c.method === "clearCommands" || c.method === "leave"),
    ).toBe(false);
  });

  test("keeping roles leaves every role in place", async () => {
    const ctx = await seeded();
    const result = await run(ctx, ["keepRoles"]);
    expect(deleted(ctx, "deleteRole")).toEqual([]);
    expect(ctx.gateway.memberRoleIds(U1)).toEqual(new Set(ctx.roleIds));
    expect(result.deletedRoles).toBe(0);
  });

  test("keeping member channels keeps them but deletes the dead panel message", async () => {
    const ctx = await seeded();
    const panel = await id(ctx, "panelChannelId");
    const message = await ctx.gateway.send(panel, {});
    await ctx.repos.setup.set("panelMessageId", message);
    const kept = await Promise.all(MEMBER_KEYS.map((k) => id(ctx, k)));

    await run(ctx, ["keepMemberChannels"]);

    for (const channel of kept) expect(deleted(ctx, "deleteChannel")).not.toContain(channel);
    expect(ctx.gateway.calls).toContainEqual({ method: "deleteMessage", args: [panel, message] });
  });

  test("keeping admin channels keeps the category and logs the uninstall there", async () => {
    const ctx = await seeded();
    const kept = await Promise.all(
      [...ADMIN_KEYS, "adminCategoryId" as const].map((k) => id(ctx, k)),
    );
    const log = await id(ctx, "logChannelId");

    const result = await run(ctx, ["keepAdminChannels"]);

    for (const channel of kept) expect(deleted(ctx, "deleteChannel")).not.toContain(channel);
    expect(result.deletedChannels).toBe(2);
    expect(ctx.gateway.messages.get(log)?.at(-1)?.payload.content).toContain(`<@${A1}>`);
  });

  test("a failure stops the run with the data intact, and a second run finishes", async () => {
    const ctx = await seeded();
    ctx.gateway.failNext("deleteChannel", new Error("Missing Permissions"));

    const failed = run(ctx);
    await expect(failed).rejects.toBeInstanceOf(UserFacingError);
    await expect(failed).rejects.toThrow("Missing Permissions");
    expect(await ctx.repos.games.list()).toHaveLength(2);
    expect(await ctx.repos.setup.get("logChannelId")).toBeDefined();
    const rolesDeletedFirstTime = deleted(ctx, "deleteRole").length;

    const result = await run(ctx);
    expect(deleted(ctx, "deleteRole")).toHaveLength(rolesDeletedFirstTime);
    expect(result.deletedRoles).toBe(0);
    expect(await ctx.repos.setup.all()).toEqual({});
  });

  test("the data is wiped only after the report and backup have been delivered", async () => {
    const ctx = await seeded();
    let gamesWhenDelivered = -1;
    await run(ctx, [], OUTSIDE, async () => {
      gamesWhenDelivered = (await ctx.repos.games.list()).length;
    });
    expect(gamesWhenDelivered).toBe(2);
    expect(await ctx.repos.games.list()).toEqual([]);
  });

  test("if the backup can't be delivered, the data is kept and a second run finishes", async () => {
    const ctx = await seeded();
    const failed = run(ctx, [], OUTSIDE, () =>
      Promise.reject(new Error("Request entity too large")),
    );
    await expect(failed).rejects.toBeInstanceOf(UserFacingError);
    await expect(failed).rejects.toThrow("Request entity too large");
    expect(await ctx.repos.games.list()).toHaveLength(2);
    expect(await ctx.repos.setup.get("logChannelId")).toBeDefined();

    let delivered: UninstallResult | undefined;
    await run(ctx, [], OUTSIDE, async (result) => {
      delivered = result;
    });
    expect(delivered?.backup.attachment.length).toBeGreaterThan(0);
    expect(await ctx.repos.games.list()).toEqual([]);
  });

  test("things already deleted by hand are skipped", async () => {
    const ctx = await seeded();
    const news = await id(ctx, "newsChannelId");
    ctx.gateway.deleteChannelBehindBotsBack(news);
    ctx.gateway.removeRoleBehindBotsBack(defined(ctx.roleIds[0]));

    const result = await run(ctx);

    expect(deleted(ctx, "deleteChannel")).not.toContain(news);
    expect(result).toMatchObject({ deletedRoles: 2, deletedChannels: 5 });
  });

  test("refuses to run from a channel it would delete, before changing anything", async () => {
    const ctx = await seeded();
    const log = await id(ctx, "logChannelId");
    await expect(run(ctx, [], log)).rejects.toBeInstanceOf(UserFacingError);
    expect(ctx.gateway.calls).toEqual([]);
    await expect(run(ctx, ["keepAdminChannels"], log)).resolves.toBeDefined();
  });
});

test("leaveServer removes the commands, then leaves", async () => {
  const ctx = await makeContext();
  await leaveServer(ctx);
  expect(ctx.gateway.calls.map((c) => c.method)).toEqual(["clearCommands", "leave"]);
});
