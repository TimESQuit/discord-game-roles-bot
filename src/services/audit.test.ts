import { MessageFlags } from "discord.js";
import { afterEach, expect, test, vi } from "vitest";

import { flagBits, lastSend, makeContext, sentTo, U1 } from "../testing/index.ts";
import { createAudit, formatAuditLine } from "./audit.ts";

afterEach(() => vi.restoreAllMocks());

test("user text can't ping or format", () => {
  const line = formatAuditLine({ kind: "suggested", userId: U1, name: "@everyone **x**" });
  expect(line).not.toMatch(/@everyone|\*\*x\*\*/);
});

test("log posts to #game-roles-log silently with no mentions allowed", async () => {
  const ctx = await makeContext();
  await ctx.audit.log({ kind: "joined", userId: U1, game: "Valheim", source: "panel" });
  const { channelId, payload } = lastSend(ctx);
  expect(channelId).toBe(await ctx.repos.setup.get("logChannelId"));
  expect(payload.allowedMentions).toEqual({ parse: [] });
  expect(flagBits(payload) & MessageFlags.SuppressNotifications).toBeTruthy();
  expect(ctx.logLines).toEqual([`<@${U1}> joined **Valheim** (panel)`]);
  expect(sentTo(ctx, "logChannelId")).toHaveLength(1);
});

test("error reports go to #game-roles-log silently, apart from the routine lines", async () => {
  const ctx = await makeContext();
  await ctx.audit.reportError("hello");
  const { channelId, payload } = lastSend(ctx);
  expect(channelId).toBe(await ctx.repos.setup.get("logChannelId"));
  expect(flagBits(payload) & MessageFlags.SuppressNotifications).toBeTruthy();
  expect(ctx.errorReports).toEqual(["hello"]);
  expect(ctx.logLines).toEqual([]);
  expect(sentTo(ctx, "adminChannelId")).toEqual([]);
});

test("an over-long error report is cut to fit a Discord message", async () => {
  const ctx = await makeContext();
  await ctx.audit.reportError("x".repeat(5000));
  const content = lastSend(ctx).payload.content ?? "";
  expect(content.length).toBeLessThanOrEqual(2000);
  expect(content).toContain("xxx");
});

test("log never throws when Discord fails", async () => {
  const ctx = await makeContext();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  ctx.gateway.failNext("send", new Error("boom"));
  await expect(
    ctx.audit.log({ kind: "suggested", userId: U1, name: "X" }),
  ).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalled();
});

test("falls back to console.log when the channel isn't recorded", async () => {
  const ctx = await makeContext({ setup: false });
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  await createAudit(ctx.repos, ctx.gateway).reportError("careful");
  expect(spy).toHaveBeenCalledWith(expect.stringContaining("careful"));
  expect(ctx.gateway.calls.filter((c) => c.method === "send")).toEqual([]);
});
