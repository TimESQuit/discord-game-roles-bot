import { DiscordAPIError } from "discord.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DISCORD_ERROR } from "../discord/index.ts";
import {
  NOTICE_LIFETIME_MS,
  TOKEN_LIFETIME_MS,
  closeIfPresent,
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

test("opening a menu closes the one the person already had open", async () => {
  const closed: string[] = [];
  await openMenus.open("u1", menu("m1", closed), NOW);
  await openMenus.open("u1", menu("m2", closed), NOW);
  expect(closed).toEqual(["m1"]);
});

test("updating the open menu in place closes nothing", async () => {
  const closed: string[] = [];
  await openMenus.open("u1", menu("m1", closed), NOW);
  await openMenus.open("u1", menu("m1", closed), NOW + 1000);
  expect(closed).toEqual([]);
});

test("one person's menu never closes another's", async () => {
  const closed: string[] = [];
  await openMenus.open("u1", menu("m1", closed), NOW);
  await openMenus.open("u2", menu("m2", closed), NOW);
  expect(closed).toEqual([]);
});

test("a menu whose token has expired is left alone", async () => {
  const closed: string[] = [];
  await openMenus.open("u1", menu("m1", closed), NOW);
  await openMenus.open("u1", menu("m2", closed, NOW + TOKEN_LIFETIME_MS), NOW + TOKEN_LIFETIME_MS);
  expect(closed).toEqual([]);
});

test("touching a menu keeps it closable for another token lifetime", async () => {
  const closed: string[] = [];
  const later = NOW + TOKEN_LIFETIME_MS - 1000;
  await openMenus.open("u1", menu("m1", closed), NOW);
  await openMenus.open("u1", menu("m1", closed, later), later);
  await openMenus.open("u1", menu("m2", closed, later + 2000), later + 2000);
  expect(closed).toEqual(["m1"]);
});

test("a forgotten menu stays when the next one opens", async () => {
  const closed: string[] = [];
  await openMenus.open("u1", menu("m1", closed), NOW);
  openMenus.forget("u1", "m1");
  await openMenus.open("u1", menu("m2", closed), NOW);
  expect(closed).toEqual([]);
});

test("forgetting a different message keeps the open menu", async () => {
  const closed: string[] = [];
  await openMenus.open("u1", menu("m1", closed), NOW);
  openMenus.forget("u1", "other");
  await openMenus.open("u1", menu("m2", closed), NOW);
  expect(closed).toEqual(["m1"]);
});

test("a failure to close the old menu does not stop the new one opening", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const closed: string[] = [];
  await openMenus.open(
    "u1",
    {
      messageId: "m1",
      expiresAt: NOW + TOKEN_LIFETIME_MS,
      close: () => Promise.reject(new Error("network")),
    },
    NOW,
  );
  await openMenus.open("u1", menu("m2", closed), NOW);
  await openMenus.open("u1", menu("m3", closed), NOW);
  expect(closed).toEqual(["m2"]);
  expect(error).toHaveBeenCalled();
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
