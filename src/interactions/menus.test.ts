import { DiscordAPIError } from "discord.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DISCORD_ERROR } from "../discord/index.ts";
import {
  NOTICE_LIFETIME_MS,
  TOKEN_LIFETIME_MS,
  closeIfPresent,
  closeNoticesNow,
  closeSoon,
  openMenus,
} from "./menus.ts";

const NOW = 1_000_000;
const apiError = (code: number) =>
  new DiscordAPIError({ code, message: "x" }, code, 404, "DELETE", "/", {});

/** A menu whose closing is recorded in `closed` under its message ID. */
function menu(messageId: string, closed: string[], openedAt = NOW) {
  return {
    messageId,
    expiresAt: openedAt + TOKEN_LIFETIME_MS,
    close: async () => void closed.push(messageId),
  };
}

beforeEach(() => openMenus.entries.clear());
afterEach(() => vi.useRealTimers());

test("opening a menu closes the one the person already had open", () => {
  const closed: string[] = [];
  openMenus.open("u1", menu("m1", closed), undefined, NOW);
  openMenus.open("u1", menu("m2", closed), undefined, NOW);
  expect(closed).toEqual(["m1"]);
});

test("updating the open menu in place closes nothing", () => {
  const closed: string[] = [];
  openMenus.open("u1", menu("m1", closed), undefined, NOW);
  openMenus.open("u1", menu("m1", closed), undefined, NOW + 1000);
  expect(closed).toEqual([]);
});

test("one person's menu never closes another's", () => {
  const closed: string[] = [];
  openMenus.open("u1", menu("m1", closed), undefined, NOW);
  openMenus.open("u2", menu("m2", closed), undefined, NOW);
  expect(closed).toEqual([]);
});

test("a menu whose token has expired is left alone", () => {
  const closed: string[] = [];
  const later = NOW + TOKEN_LIFETIME_MS;
  openMenus.open("u1", menu("m1", closed), undefined, NOW);
  openMenus.open("u1", menu("m2", closed, later), undefined, later);
  expect(closed).toEqual([]);
});

test("touching a menu keeps it closable for another token lifetime", () => {
  const closed: string[] = [];
  const later = NOW + TOKEN_LIFETIME_MS - 1000;
  openMenus.open("u1", menu("m1", closed), undefined, NOW);
  openMenus.open("u1", menu("m1", closed, later), undefined, later);
  openMenus.open("u1", menu("m2", closed, later + 2000), undefined, later + 2000);
  expect(closed).toEqual(["m1"]);
});

test("a menu built before a newer one opened is the one that closes", () => {
  const closed: string[] = [];
  const since = openMenus.ticket();
  openMenus.open("u1", menu("newer", closed), undefined, NOW);
  openMenus.open("u1", menu("stale", closed), since, NOW);
  expect(closed).toEqual(["stale"]);
  openMenus.open("u1", menu("next", closed), undefined, NOW);
  expect(closed).toEqual(["stale", "newer"]);
});

test("a menu opened by someone else meanwhile does not make yours stale", () => {
  const closed: string[] = [];
  openMenus.open("u1", menu("mine", closed), undefined, NOW);
  const since = openMenus.ticket();
  openMenus.open("u2", menu("theirs", closed), undefined, NOW);
  openMenus.open("u1", menu("my-next", closed), since, NOW);
  expect(closed).toEqual(["mine"]);
});

test("a forgotten menu stays when the next one opens", () => {
  const closed: string[] = [];
  openMenus.open("u1", menu("m1", closed), undefined, NOW);
  openMenus.forget("u1", "m1");
  openMenus.open("u1", menu("m2", closed), undefined, NOW);
  expect(closed).toEqual([]);
});

test("forgetting a different message keeps the open menu", () => {
  const closed: string[] = [];
  openMenus.open("u1", menu("m1", closed), undefined, NOW);
  openMenus.forget("u1", "other");
  openMenus.open("u1", menu("m2", closed), undefined, NOW);
  expect(closed).toEqual(["m1"]);
});

test("a failure to close the old menu is logged and does not stop the new one opening", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const closed: string[] = [];
  const failing = { ...menu("m1", closed), close: () => Promise.reject(new Error("network")) };
  openMenus.open("u1", failing, undefined, NOW);
  openMenus.open("u1", menu("m2", closed), undefined, NOW);
  openMenus.open("u1", menu("m3", closed), undefined, NOW);
  expect(closed).toEqual(["m2"]);
  await vi.waitFor(() => expect(error).toHaveBeenCalled());
  error.mockRestore();
});

test("a message that is already gone counts as closed", async () => {
  for (const code of [
    DISCORD_ERROR.unknownMessage,
    DISCORD_ERROR.unknownWebhook,
    DISCORD_ERROR.invalidWebhookToken,
  ]) {
    await expect(closeIfPresent(() => Promise.reject(apiError(code)))).resolves.toBeUndefined();
  }
  await expect(
    closeIfPresent(() => Promise.reject(apiError(DISCORD_ERROR.missingAccess))),
  ).rejects.toThrow("x");
});

test("a notice closes itself after its lifetime, not before", async () => {
  vi.useFakeTimers();
  const closed: string[] = [];
  closeSoon(async () => void closed.push("notice"));
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS - 1);
  expect(closed).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(closed).toEqual(["notice"]);
});

test("on shutdown, waiting notices close at once and only once", async () => {
  vi.useFakeTimers();
  const closed: string[] = [];
  closeSoon(async () => void closed.push("a"));
  closeSoon(async () => void closed.push("b"));
  await closeNoticesNow();
  expect(closed).toEqual(["a", "b"]);
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(closed).toEqual(["a", "b"]);
});
