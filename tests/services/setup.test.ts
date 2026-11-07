import { describe, expect, test } from "vitest";
import {
  ADMIN_CATEGORY_NAME,
  ADMIN_CHANNEL_NAME,
  BACKUPS_CHANNEL_NAME,
  LOG_CHANNEL_NAME,
  NEWS_CHANNEL_NAME,
  PANEL_CHANNEL_NAME,
  STARTING_CATEGORIES,
  TEMPLATE_ROLE_NAME,
} from "../../src/constants.ts";
import type { Overwrite } from "../../src/discord/gateway.ts";
import {
  applySetup,
  checkSetup,
  previewSetup,
  refreshPanel,
  REQUIRED_PERMISSIONS,
} from "../../src/services/setup.ts";
import { A1, ADMIN_ROLE_ID, makeContext } from "../fakes/context.ts";

const readOnlyForEveryone = (botId: string): Overwrite[] => [
  {
    id: "everyone",
    allow: ["ViewChannel"],
    deny: ["SendMessages", "CreatePublicThreads", "AddReactions"],
  },
  { id: botId, allow: ["SendMessages", "EmbedLinks", "AttachFiles"], deny: [] },
];
const adminOnly = (botId: string): Overwrite[] => [
  { id: "everyone", allow: [], deny: ["ViewChannel"] },
  { id: ADMIN_ROLE_ID, allow: ["ViewChannel"], deny: [] },
  {
    id: botId,
    allow: ["ViewChannel", "SendMessages", "AttachFiles", "ReadMessageHistory"],
    deny: [],
  },
];

const creates = (ctx: Awaited<ReturnType<typeof makeContext>>, method: string) =>
  ctx.gateway.calls.filter((c) => c.method === method);

describe("checkSetup", () => {
  test("lists each missing permission as its own sentence", async () => {
    const ctx = await makeContext({ setup: false });
    ctx.gateway.setMissingPermissions(["ManageRoles", "EmbedLinks", "ReadMessageHistory"]);
    expect(await checkSetup(ctx)).toEqual([
      "Give the bot the Manage Roles permission.",
      "Give the bot the Embed Links permission.",
      "Give the bot the Read Message History permission.",
    ]);
    expect(REQUIRED_PERMISSIONS).toHaveLength(7);
  });

  test("reports the role-position problem only when the template exists", async () => {
    const ctx = await makeContext();
    ctx.gateway.setBotTopPosition(5);
    expect(await checkSetup(ctx)).toEqual([
      "Move the bot's role above Game role template in Server Settings → Roles",
    ]);
    const blank = await makeContext({ setup: false });
    blank.gateway.setBotTopPosition(5);
    expect(await checkSetup(blank)).toEqual([]);
  });

  test("no problems on a healthy server", async () => {
    expect(await checkSetup(await makeContext())).toEqual([]);
  });
});

describe("previewSetup", () => {
  test("a blank server previews everything; a set-up server previews nothing", async () => {
    const blank = await previewSetup(await makeContext({ setup: false }));
    expect(blank.problems).toEqual([]);
    expect(blank.plan.create).toHaveLength(9);
    const full = await previewSetup(await makeContext());
    expect(full.plan.create).toEqual(["panelMessage"]);
  });
});

describe("applySetup", () => {
  test("creates everything on a blank server and records every ID", async () => {
    const ctx = await makeContext({ setup: false });
    const result = await applySetup(ctx, A1);
    expect(result.created).toHaveLength(9);
    expect(result.fine).toEqual([]);

    const all = await ctx.repos.setup.all();
    expect(Object.keys(all).sort()).toEqual([
      "adminCategoryId",
      "adminChannelId",
      "backupsChannelId",
      "logChannelId",
      "newsChannelId",
      "panelChannelId",
      "panelMessageId",
      "templateRoleId",
    ]);
    expect(ctx.gateway.role(all.templateRoleId!)?.name).toBe(TEMPLATE_ROLE_NAME);
    expect((await ctx.repos.categories.list()).map((c) => c.name)).toEqual([
      ...STARTING_CATEGORIES,
    ]);

    const role = creates(ctx, "createRole")[0]!;
    expect(role.args[0]).toEqual({ name: TEMPLATE_ROLE_NAME, color: 0, mentionable: true });

    const panel = ctx.gateway.messages.get(all.panelChannelId!)!;
    expect(panel).toHaveLength(1);
    expect(panel[0]!.id).toBe(all.panelMessageId);
    expect(ctx.logLines).toHaveLength(1);
    expect(ctx.logLines[0]).toContain("ran setup");
  });

  test("overwrites: panel and news read-only for everyone, admin category hidden", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const bot = ctx.gateway.botUserId;
    const all = await ctx.repos.setup.all();
    const text = new Map(creates(ctx, "createTextChannel").map((c) => [c.args[0], c.args]));
    expect(text.get(PANEL_CHANNEL_NAME)?.[1]).toBeNull();
    expect(text.get(PANEL_CHANNEL_NAME)?.[2]).toEqual(readOnlyForEveryone(bot));
    expect(text.get(NEWS_CHANNEL_NAME)?.[2]).toEqual(readOnlyForEveryone(bot));
    const category = creates(ctx, "createCategory")[0]!;
    expect(category.args).toEqual([ADMIN_CATEGORY_NAME, adminOnly(bot)]);
    for (const name of [ADMIN_CHANNEL_NAME, LOG_CHANNEL_NAME, BACKUPS_CHANNEL_NAME]) {
      expect(text.get(name)?.[1]).toBe(all.adminCategoryId);
      expect(text.get(name)?.[2]).toEqual(adminOnly(bot));
    }
  });

  test("apply twice: the second run creates nothing and reports all fine", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const before = ctx.gateway.calls.length;
    const second = await applySetup(ctx, A1);
    expect(second.created).toEqual([]);
    expect(second.fine).toHaveLength(9);
    expect(ctx.gateway.calls.slice(before).filter((c) => c.method.startsWith("create"))).toEqual(
      [],
    );
    expect(ctx.gateway.calls.slice(before).filter((c) => c.method === "send")).toHaveLength(1);
  });

  test("repairs a deleted news channel and nothing else", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const old = (await ctx.repos.setup.get("newsChannelId"))!;
    ctx.gateway.deleteChannelBehindBotsBack(old);
    const before = ctx.gateway.calls.length;
    const result = await applySetup(ctx, A1);
    expect(result.created).toEqual(["newsChannel"]);
    const fresh = ctx.gateway.calls.slice(before).filter((c) => c.method.startsWith("create"));
    expect(fresh.map((c) => c.method)).toEqual(["createTextChannel"]);
    expect(await ctx.repos.setup.get("newsChannelId")).not.toBe(old);
  });

  test("deleted admin category: recreated, existing admin channels moved in, none recreated", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const s = await ctx.repos.setup.all();
    ctx.gateway.deleteChannelBehindBotsBack(s.adminCategoryId!);
    const before = ctx.gateway.calls.length;
    const result = await applySetup(ctx, A1);
    expect(result.created).toEqual(["adminCategory"]);
    const fresh = ctx.gateway.calls.slice(before);
    expect(fresh.filter((c) => c.method === "createTextChannel")).toEqual([]);
    const newCategory = (await ctx.repos.setup.get("adminCategoryId"))!;
    expect(newCategory).not.toBe(s.adminCategoryId);
    expect(fresh.filter((c) => c.method === "setChannelParent").map((c) => c.args)).toEqual([
      [s.adminChannelId, newCategory],
      [s.logChannelId, newCategory],
      [s.backupsChannelId, newCategory],
    ]);
  });

  test("keeps existing categories instead of adding the starting ones", async () => {
    const ctx = await makeContext({ setup: false });
    await ctx.repos.categories.add("Mine");
    await applySetup(ctx, A1);
    expect((await ctx.repos.categories.list()).map((c) => c.name)).toEqual(["Mine"]);
  });

  test("refuses with the problems, one per line, and creates nothing", async () => {
    const ctx = await makeContext({ setup: false });
    ctx.gateway.setMissingPermissions(["ManageRoles", "ManageChannels"]);
    await expect(applySetup(ctx, A1)).rejects.toThrow(
      "Give the bot the Manage Roles permission.\nGive the bot the Manage Channels permission.",
    );
    expect(ctx.gateway.calls).toEqual([]);
    expect(await ctx.repos.setup.all()).toEqual({});
  });
});

describe("refreshPanel", () => {
  test("edits the existing message", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const id = await ctx.repos.setup.get("panelMessageId");
    expect(await refreshPanel(ctx, A1)).toBe("updated");
    expect(await ctx.repos.setup.get("panelMessageId")).toBe(id);
    expect(creates(ctx, "edit")).toHaveLength(1);
  });

  test("reposts and records a new ID if the message was deleted", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const channel = (await ctx.repos.setup.get("panelChannelId"))!;
    const id = (await ctx.repos.setup.get("panelMessageId"))!;
    ctx.gateway.deleteMessageBehindBotsBack(channel, id);
    expect(await refreshPanel(ctx, A1)).toBe("reposted");
    const fresh = await ctx.repos.setup.get("panelMessageId");
    expect(fresh).not.toBe(id);
    expect(ctx.gateway.messages.get(channel)!.map((m) => m.id)).toEqual([fresh]);
  });

  test("without a panel channel it asks for setup", async () => {
    const ctx = await makeContext({ setup: false });
    await expect(refreshPanel(ctx, A1)).rejects.toThrow("Run /gameadmin setup first.");
  });

  test("a recorded but deleted panel channel asks for setup", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    ctx.gateway.deleteChannelBehindBotsBack((await ctx.repos.setup.get("panelChannelId"))!);
    await expect(refreshPanel(ctx, A1)).rejects.toThrow("Run /gameadmin setup first.");
  });

  test("audits one setup line saying how the panel was refreshed", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    await refreshPanel(ctx, A1);
    const channel = (await ctx.repos.setup.get("panelChannelId"))!;
    ctx.gateway.deleteMessageBehindBotsBack(
      channel,
      (await ctx.repos.setup.get("panelMessageId"))!,
    );
    await refreshPanel(ctx, A1);
    expect(ctx.logLines.slice(-2)).toEqual([
      `<@${A1}> ran setup: refreshed the panel (updated)`,
      `<@${A1}> ran setup: refreshed the panel (reposted)`,
    ]);
  });
});

describe("setup failure handling", () => {
  const missingAccess = () => new Error("Missing Access");

  test("missing permissions beat a failing message lookup", async () => {
    const ctx = await makeContext();
    await ctx.repos.setup.set("panelMessageId", "100000000000000900");
    ctx.gateway.setMissingPermissions(["ReadMessageHistory"]);
    ctx.gateway.failNext("messageExists", missingAccess());
    await expect(applySetup(ctx, A1)).rejects.toThrow(
      "Give the bot the Read Message History permission.",
    );
    const preview = await previewSetup(ctx);
    expect(preview.problems).toEqual(["Give the bot the Read Message History permission."]);
    expect(ctx.gateway.calls.filter((c) => c.method === "messageExists")).toEqual([]);
  });

  test("a failure while creating channels is repaired by re-running without duplicates", async () => {
    const ctx = await makeContext({ setup: false });
    ctx.gateway.failNext("createTextChannel", new Error("boom"));
    await expect(applySetup(ctx, A1)).rejects.toThrow("boom");
    // The panel channel failed; nothing after it ran.
    expect(creates(ctx, "createRole")).toHaveLength(1);
    const result = await applySetup(ctx, A1);
    expect(result.fine).toEqual(["templateRole"]);
    expect(result.created).toHaveLength(8);
    expect(creates(ctx, "createRole")).toHaveLength(1);
    const names = creates(ctx, "createTextChannel").map((c) => c.args[0]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("a failed move leaves the category unrecorded so a re-run moves every channel", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const s = await ctx.repos.setup.all();
    ctx.gateway.deleteChannelBehindBotsBack(s.adminCategoryId!);
    ctx.gateway.failNext("setChannelParent", new Error("boom"));
    await expect(applySetup(ctx, A1)).rejects.toThrow("boom");
    expect(await ctx.repos.setup.get("adminCategoryId")).toBe(s.adminCategoryId);
    const before = ctx.gateway.calls.length;
    await applySetup(ctx, A1);
    const moves = ctx.gateway.calls.slice(before).filter((c) => c.method === "setChannelParent");
    expect(moves.map((c) => c.args[0])).toEqual([
      s.adminChannelId,
      s.logChannelId,
      s.backupsChannelId,
    ]);
    expect(await ctx.repos.setup.get("adminCategoryId")).not.toBe(s.adminCategoryId);
  });
});
