import { DiscordAPIError, MessageFlags, MessageFlagsBitField } from "discord.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DISCORD_ERROR } from "../discord/index.ts";
import { FAKE_USER_ID, deletedIds, fakeButton, flagBits, methods } from "../testing/index.ts";
import { menuView, messageView, noticeView } from "../views/index.ts";
import { NOTICE_LIFETIME_MS, TOKEN_LIFETIME_MS, openMenus } from "./menus.ts";
import {
  PRIVATE_V2_DEFER,
  deferAndKeep,
  forEdit,
  forReply,
  noticePrivately,
  replyPrivately,
  sayPrivately,
  showPrivately,
  updateWith,
} from "./replies.ts";

import type { Call } from "../testing/index.ts";

test("the defer flags resolve to Ephemeral | IsComponentsV2", () => {
  expect(new MessageFlagsBitField(PRIVATE_V2_DEFER).bitfield).toBe(
    MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  );
});

test("a private view replies privately and edits keep only the layout flag", () => {
  const view = noticeView("hello");
  expect(forReply(view).flags).toBe(view.flags);
  expect(flagBits(view)).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
  expect(forReply(view).components).toBe(view.components);
  expect(forEdit(view).flags).toBe(MessageFlags.IsComponentsV2);
  expect(forEdit(view).components).toBe(view.components);
});

const USER = FAKE_USER_ID;
const deleted = deletedIds;
const menu = async () => menuView({ isAdmin: false });

/** Opens a stand-in menu for USER; returns the IDs it was asked to close. */
function openOtherMenu(messageId = "other-menu"): string[] {
  const closed: string[] = [];
  openMenus.open(USER, {
    messageId,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    close: async () => void closed.push(messageId),
  });
  return closed;
}

beforeEach(() => openMenus.entries.clear());
afterEach(() => vi.useRealTimers());

test("updateWith defers before it renders, then edits", async () => {
  const calls: Call[] = [];
  await updateWith(fakeButton(calls), async () => {
    calls.push({ method: "render" });
    return noticeView("done");
  });
  expect(methods(calls)).toEqual(["deferUpdate", "render", "editReply"]);
});

test("noticePrivately defers a private reply, then edits in the notice", async () => {
  const calls: Call[] = [];
  await noticePrivately(fakeButton(calls), async () => "saved");
  expect(methods(calls)).toEqual(["deferReply", "editReply"]);
});

test("a menu shown in place becomes the open menu, closing the one before", async () => {
  const before = openOtherMenu();
  const calls: Call[] = [];
  await updateWith(fakeButton(calls), menu);
  expect(before).toEqual(["other-menu"]);
  openOtherMenu();
  expect(deleted(calls)).toEqual(["menu-1"]);
});

test("a new private reply holding a menu becomes the open menu", async () => {
  const before = openOtherMenu();
  const calls: Call[] = [];
  await replyPrivately(fakeButton(calls), menu);
  expect(before).toEqual(["other-menu"]);
  openOtherMenu();
  expect(deleted(calls)).toEqual(["reply-1"]);
});

test("showPrivately replies at once and makes the reply the open menu", async () => {
  const before = openOtherMenu();
  const calls: Call[] = [];
  await showPrivately(fakeButton(calls), await menu());
  expect(methods(calls)[0]).toBe("reply");
  expect(before).toEqual(["other-menu"]);
  openOtherMenu();
  expect(deleted(calls)).toEqual(["reply-1"]);
});

test("a slow reply that finishes after a newer menu opened closes itself, not the newer one", async () => {
  const calls: Call[] = [];
  let newer: string[] = [];
  await replyPrivately(fakeButton(calls), async () => {
    newer = openOtherMenu("newer");
    return menu();
  });
  expect(deleted(calls)).toEqual(["reply-1"]);
  expect(newer).toEqual([]);
});

test("a slow update that finishes after a newer menu opened closes itself, not the newer one", async () => {
  const calls: Call[] = [];
  await updateWith(fakeButton(calls), menu);
  let newer: string[] = [];
  await updateWith(fakeButton(calls), async () => {
    newer = openOtherMenu("newer");
    return menu();
  });
  expect(newer).toEqual([]);
  expect(deleted(calls)).toEqual(["menu-1", "menu-1"]);
});

test("a menu deleted by a newer one while it was updating ends quietly", async () => {
  const calls: Call[] = [];
  const press = fakeButton(calls);
  Object.assign(press, {
    editReply: async () => {
      throw new DiscordAPIError(
        { code: DISCORD_ERROR.unknownMessage, message: "Unknown Message" },
        DISCORD_ERROR.unknownMessage,
        404,
        "PATCH",
        "/",
        {},
      );
    },
  });
  await expect(updateWith(press, menu)).resolves.toBeUndefined();
});

test("a menu that turns into a notice closes after the notice lifetime and stops being tracked", async () => {
  vi.useFakeTimers();
  const calls: Call[] = [];
  await updateWith(fakeButton(calls), menu);
  await updateWith(fakeButton(calls), async () => noticeView("Removed X."));
  openOtherMenu();
  expect(deleted(calls)).toEqual([]);
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(deleted(calls)).toEqual(["menu-1"]);
});

test("a view carrying a file is never tracked, so a later menu doesn't delete it", async () => {
  const calls: Call[] = [];
  await replyPrivately(fakeButton(calls), async () => ({
    ...(await menu()),
    files: [{ attachment: Buffer.from("{}"), name: "backup.json" }],
  }));
  openOtherMenu();
  expect(deleted(calls)).toEqual([]);
});

test("a message kept for a file can't be deleted by a menu opened during the slow work", async () => {
  const calls: Call[] = [];
  await updateWith(fakeButton(calls), menu);
  await deferAndKeep(fakeButton(calls));
  openOtherMenu();
  expect(deleted(calls)).toEqual([]);
});

test("a notice reply closes itself and leaves the open menu alone", async () => {
  vi.useFakeTimers();
  const before = openOtherMenu();
  const calls: Call[] = [];
  await noticePrivately(fakeButton(calls), async () => "saved");
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(deleted(calls)).toEqual(["reply-1"]);
  expect(before).toEqual([]);
});

test("a notice said after the interaction was answered goes as a follow-up and closes itself", async () => {
  vi.useFakeTimers();
  const calls: Call[] = [];
  await sayPrivately(fakeButton(calls, { deferred: true }), noticeView("Approved X."));
  expect(methods(calls)).toEqual(["followUp"]);
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(deleted(calls)).toEqual(["follow-up-1"]);
});

test("a message that isn't a notice, such as an error, stays", async () => {
  vi.useFakeTimers();
  const calls: Call[] = [];
  await sayPrivately(fakeButton(calls), messageView("Something went wrong."));
  await sayPrivately(fakeButton(calls, { deferred: true }), messageView("Something went wrong."));
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(methods(calls)).toEqual(["reply", "followUp"]);
});

test("a public message updated in place is never tracked, so it is never deleted", async () => {
  const calls: Call[] = [];
  await updateWith(fakeButton(calls, { ephemeral: false }), menu);
  openOtherMenu();
  expect(deleted(calls)).toEqual([]);
});
