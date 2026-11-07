import { afterEach, expect, test, vi } from "vitest";
import { createAudit, formatAuditLine } from "./audit.ts";
import { A1, lastSend, makeContext, sentTo, U1 } from "../testing/index.ts";

afterEach(() => vi.restoreAllMocks());

test("join line names user, game and source", () => {
  expect(formatAuditLine({ kind: "joined", userId: U1, game: "Valheim", source: "lfg" })).toBe(
    `<@${U1}> joined **Valheim** (LFG post)`,
  );
});

test("rejection line includes reviewer and reason", () => {
  expect(
    formatAuditLine({ kind: "suggestion-rejected", userId: A1, name: "Foo", reason: "dupe" }),
  ).toBe(`<@${A1}> rejected suggestion **Foo**: dupe`);
});

const suggestionLine = (
  kind: "suggestion-approved" | "suggestion-edited" | "suggestion-withdrawn",
) => formatAuditLine({ kind, userId: A1, name: "Foo" });

test("suggestion verbs are past tense", () => {
  expect(suggestionLine("suggestion-approved")).toBe(`<@${A1}> approved suggestion **Foo**`);
  expect(suggestionLine("suggestion-edited")).toBe(`<@${A1}> edited suggestion **Foo**`);
  expect(suggestionLine("suggestion-withdrawn")).toBe(`<@${A1}> withdrew suggestion **Foo**`);
});

test("user text can't ping or format", () => {
  const line = formatAuditLine({ kind: "suggested", userId: U1, name: "@everyone **x**" });
  expect(line).not.toMatch(/@everyone|\*\*x\*\*/);
});

test("every event kind produces a line", () => {
  expect(formatAuditLine({ kind: "backup", userId: null, file: "a.sqlite" })).toContain("a.sqlite");
  expect(formatAuditLine({ kind: "template-reapplied", userId: A1, count: 3 })).toContain("3");
  expect(formatAuditLine({ kind: "left", userId: U1, game: "G", source: "panel" })).toContain(
    "(panel)",
  );
});

test("the suggestion source reads as 'suggestion'", () => {
  expect(
    formatAuditLine({ kind: "joined", userId: U1, game: "G", source: "suggestion" }),
  ).toContain("(suggestion)");
});

test("log posts to #bot-log with no mentions allowed", async () => {
  const ctx = await makeContext();
  await ctx.audit.log({ kind: "joined", userId: U1, game: "Valheim", source: "panel" });
  const { channelId, payload } = lastSend(ctx);
  expect(channelId).toBe(await ctx.repos.setup.get("logChannelId"));
  expect(payload.allowedMentions).toEqual({ parse: [] });
  expect(ctx.logLines).toEqual([`<@${U1}> joined **Valheim** (panel)`]);
  expect(sentTo(ctx, "logChannelId")).toHaveLength(1);
});

test("admin notices go to #bot-admin", async () => {
  const ctx = await makeContext();
  await ctx.audit.notifyAdmins("hello");
  expect(ctx.adminNotices).toEqual(["hello"]);
  expect(ctx.logLines).toEqual([]);
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
  await createAudit(ctx.repos, ctx.gateway).notifyAdmins("careful");
  expect(spy).toHaveBeenCalledWith("careful");
  expect(ctx.gateway.calls.filter((c) => c.method === "send")).toEqual([]);
});
