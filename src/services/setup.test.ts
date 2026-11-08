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
} from "../constants.ts";
import { A1, ADMIN_ROLE_ID, defined, makeContext } from "../testing/index.ts";
import { applySetup, checkSetup, previewSetup, refreshPanel } from "./setup.ts";

import type { Overwrite } from "../discord/index.ts";

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
  });

  test("lists the thread and reaction permissions the read-only channels need", async () => {
    const ctx = await makeContext({ setup: false });
    ctx.gateway.setMissingPermissions(["CreatePublicThreads", "AddReactions"]);
    expect(await checkSetup(ctx)).toEqual([
      "Give the bot the Create Public Threads permission.",
      "Give the bot the Add Reactions permission.",
    ]);
  });

  test("reports the role-position problem only when the template exists", async () => {
    const ctx = await makeContext();
    ctx.gateway.setBotTopPosition(5);
    expect(await checkSetup(ctx)).toEqual([
      "Move the bot's role above Game role template in Server Settings → Roles.",
    ]);
    const blank = await makeContext({ setup: false });
    blank.gateway.setBotTopPosition(5);
    expect(await checkSetup(blank)).toEqual([]);
  });

  test("bot's role tied with the template → the tie fix, not 'move the bot's role'", async () => {
    const ctx = await makeContext();
    const position = defined(
      ctx.gateway.roles().find((r) => r.name === "Game role template"),
    ).position;
    ctx.gateway.addRole({
      id: "100000000000000999",
      name: "Game Roles",
      position,
      color: 0,
      mentionable: false,
    });
    ctx.gateway.setBotTopPosition(position);
    expect(await checkSetup(ctx)).toEqual([
      "Some roles share a position, so the bot can't sort game roles. In Server Settings → Roles, drag any role down one place and back up, then try again.",
    ]);
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
  test("two concurrent runs create one set; the second is refused", async () => {
    const ctx = await makeContext({ setup: false });
    const results = await Promise.allSettled([applySetup(ctx, A1), applySetup(ctx, A1)]);
    expect(results.map((r) => r.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")?.reason).toMatchObject({
      message: "Setup is already running.",
    });
    expect(creates(ctx, "createRole")).toHaveLength(1);
    expect(creates(ctx, "createCategory")).toHaveLength(1);
    await expect(applySetup(ctx, A1)).resolves.toBeDefined();
  });

  test("creates everything on a blank server and records every ID", async () => {
    const ctx = await makeContext({ setup: false });
    const result = await applySetup(ctx, A1);
    expect(result.created).toHaveLength(9);
    expect(result.fine).toEqual([]);

    const all = await ctx.repos.setup.all();
    expect(Object.keys(all).toSorted()).toEqual([
      "adminCategoryId",
      "adminChannelId",
      "backupsChannelId",
      "logChannelId",
      "newsChannelId",
      "panelChannelId",
      "panelMessageId",
      "templateRoleId",
    ]);
    expect(ctx.gateway.role(defined(all.templateRoleId))?.name).toBe(TEMPLATE_ROLE_NAME);
    expect((await ctx.repos.categories.list()).map((c) => c.name)).toEqual([
      ...STARTING_CATEGORIES,
    ]);

    const role = defined(creates(ctx, "createRole")[0]);
    expect(role.args[0]).toEqual({ name: TEMPLATE_ROLE_NAME, color: 0, mentionable: true });

    const panel = defined(ctx.gateway.messages.get(defined(all.panelChannelId)));
    expect(panel).toHaveLength(1);
    expect(defined(panel[0]).id).toBe(all.panelMessageId);
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
    const category = defined(creates(ctx, "createCategory")[0]);
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
    const old = defined(await ctx.repos.setup.get("newsChannelId"));
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
    ctx.gateway.deleteChannelBehindBotsBack(defined(s.adminCategoryId));
    const before = ctx.gateway.calls.length;
    const result = await applySetup(ctx, A1);
    expect(result.created).toEqual(["adminCategory"]);
    const fresh = ctx.gateway.calls.slice(before);
    expect(fresh.filter((c) => c.method === "createTextChannel")).toEqual([]);
    const newCategory = defined(await ctx.repos.setup.get("adminCategoryId"));
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
  test("two concurrent refreshes post one panel; the second is refused", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    const channel = defined(await ctx.repos.setup.get("panelChannelId"));
    ctx.gateway.deleteMessageBehindBotsBack(
      channel,
      defined(await ctx.repos.setup.get("panelMessageId")),
    );
    const results = await Promise.allSettled([refreshPanel(ctx, A1), refreshPanel(ctx, A1)]);
    expect(results.map((r) => r.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")?.reason).toMatchObject({
      message: "The panel is already being refreshed.",
    });
    expect(ctx.gateway.messages.get(channel)).toHaveLength(1);
    await expect(refreshPanel(ctx, A1)).resolves.toBe("updated");
  });

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
    const channel = defined(await ctx.repos.setup.get("panelChannelId"));
    const id = defined(await ctx.repos.setup.get("panelMessageId"));
    ctx.gateway.deleteMessageBehindBotsBack(channel, id);
    expect(await refreshPanel(ctx, A1)).toBe("reposted");
    const fresh = await ctx.repos.setup.get("panelMessageId");
    expect(fresh).not.toBe(id);
    expect(defined(ctx.gateway.messages.get(channel)).map((m) => m.id)).toEqual([fresh]);
  });

  test("without a panel channel it asks for setup", async () => {
    const ctx = await makeContext({ setup: false });
    await expect(refreshPanel(ctx, A1)).rejects.toThrow("Run /gameadmin setup first.");
  });

  test("a recorded but deleted panel channel asks for setup", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    ctx.gateway.deleteChannelBehindBotsBack(defined(await ctx.repos.setup.get("panelChannelId")));
    await expect(refreshPanel(ctx, A1)).rejects.toThrow("Run /gameadmin setup first.");
  });

  test("audits one setup line saying how the panel was refreshed", async () => {
    const ctx = await makeContext({ setup: false });
    await applySetup(ctx, A1);
    await refreshPanel(ctx, A1);
    const channel = defined(await ctx.repos.setup.get("panelChannelId"));
    ctx.gateway.deleteMessageBehindBotsBack(
      channel,
      defined(await ctx.repos.setup.get("panelMessageId")),
    );
    await refreshPanel(ctx, A1);
    expect(ctx.logLines.slice(-2)).toEqual([
      `<@${A1}> ran setup: refreshed the panel (updated)`,
      `<@${A1}> ran setup: refreshed the panel (reposted)`,
    ]);
  });
});

const missingAccess = () => new Error("Missing Access");

describe("setup failure handling", () => {
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
    ctx.gateway.deleteChannelBehindBotsBack(defined(s.adminCategoryId));
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
