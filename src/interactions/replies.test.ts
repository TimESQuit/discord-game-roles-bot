import { MessageFlags, MessageFlagsBitField } from "discord.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { FAKE_USER_ID, deletedIds, fakeButton, flagBits } from "../testing/index.ts";
import { menuView, noticeView } from "../views/index.ts";
import { NOTICE_LIFETIME_MS, TOKEN_LIFETIME_MS, openMenus } from "./menus.ts";
import {
  PRIVATE_V2_DEFER,
  followUpNotice,
  forEdit,
  forReply,
  noticePrivately,
  replyPrivately,
  showPrivately,
  updateWith,
} from "./replies.ts";

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

/** Opens a stand-in menu for USER; returns the IDs it was asked to close. */
async function openOtherMenu(messageId = "other-menu"): Promise<string[]> {
  const closed: string[] = [];
  await openMenus.open(USER, {
    messageId,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    close: async () => void closed.push(messageId),
  });
  return closed;
}

beforeEach(() => openMenus.entries.clear());
afterEach(() => vi.useRealTimers());

test("updateWith defers before it renders, then edits", async () => {
  const log: string[] = [];
  await updateWith(fakeButton(log), async () => {
    log.push("render");
    return noticeView("done");
  });
  expect(log).toEqual(["deferUpdate", "render", "editReply:done"]);
});

test("noticePrivately defers a private reply, then edits in the notice", async () => {
  const log: string[] = [];
  await noticePrivately(fakeButton(log), async () => "saved");
  expect(log).toEqual(["deferReply", "editReply:saved"]);
});

test("a menu shown in place becomes the open menu, closing the one before", async () => {
  const before = await openOtherMenu();
  const log: string[] = [];
  await updateWith(fakeButton(log), async () => menuView({ isAdmin: false }));
  expect(before).toEqual(["other-menu"]);
  await openOtherMenu();
  expect(deleted(log)).toEqual(["menu-1"]);
});

test("a new private reply holding a menu becomes the open menu", async () => {
  const before = await openOtherMenu();
  const log: string[] = [];
  await replyPrivately(fakeButton(log), async () => menuView({ isAdmin: false }));
  expect(before).toEqual(["other-menu"]);
  await openOtherMenu();
  expect(deleted(log)).toEqual(["reply-1"]);
});

test("showPrivately replies at once and makes the reply the open menu", async () => {
  const before = await openOtherMenu();
  const log: string[] = [];
  await showPrivately(fakeButton(log), menuView({ isAdmin: false }));
  expect(log[0]).toBe("reply");
  expect(before).toEqual(["other-menu"]);
  await openOtherMenu();
  expect(deleted(log)).toEqual(["reply-1"]);
});

test("a menu that turns into a notice closes after the notice lifetime and stops being tracked", async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  await updateWith(fakeButton(log), async () => menuView({ isAdmin: false }));
  await updateWith(fakeButton(log), async () => noticeView("Removed X."));
  await openOtherMenu();
  expect(deleted(log)).toEqual([]);
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(deleted(log)).toEqual(["menu-1"]);
});

test("a notice reply closes itself and leaves the open menu alone", async () => {
  vi.useFakeTimers();
  const before = await openOtherMenu();
  const log: string[] = [];
  await noticePrivately(fakeButton(log), async () => "saved");
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(deleted(log)).toEqual(["reply-1"]);
  expect(before).toEqual([]);
});

test("a follow-up notice closes itself", async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  await followUpNotice(fakeButton(log), "Approved X.");
  await vi.advanceTimersByTimeAsync(NOTICE_LIFETIME_MS);
  expect(deleted(log)).toEqual(["follow-up-1"]);
});

test("a public message updated in place is never tracked, so it is never deleted", async () => {
  const log: string[] = [];
  await updateWith(fakeButton(log, { ephemeral: false }), async () => menuView({ isAdmin: false }));
  await openOtherMenu();
  expect(deleted(log)).toEqual([]);
});
