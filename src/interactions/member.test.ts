import { beforeEach, expect, test } from "vitest";

import { encodeId } from "../domain/index.ts";
import { deletedIds, fakeButton, makeContext } from "../testing/index.ts";
import { memberHandlers } from "./member.ts";
import { openMenus } from "./menus.ts";

import type { Call } from "../testing/index.ts";
import type { Handler } from "./router.ts";

const handler = (name: keyof typeof memberHandlers): Handler => {
  const found = memberHandlers[name];
  if (found === undefined) throw new Error(`No handler ${name}`);
  return found;
};

beforeEach(() => openMenus.entries.clear());

test("opening the menu again closes the one already open", async () => {
  const ctx = await makeContext();
  const first: Call[] = [];
  const second: Call[] = [];
  await handler("panel-open")(ctx, fakeButton(first, { replyId: "menu-a" }));
  await handler("panel-open")(ctx, fakeButton(second, { replyId: "menu-b" }));
  expect(deletedIds(first)).toEqual(["menu-a"]);
  expect(deletedIds(second)).toEqual([]);
});

test("Close deletes the message it sits on, and a later menu does not try again", async () => {
  const ctx = await makeContext();
  const opened: Call[] = [];
  await handler("panel-open")(ctx, fakeButton(opened, { replyId: "menu-a" }));
  const closed: Call[] = [];
  const close = fakeButton(closed, { customId: encodeId({ kind: "close" }), onMessage: "menu-a" });
  await handler("close")(ctx, close);
  await handler("panel-open")(ctx, fakeButton([], { replyId: "menu-b" }));
  expect(deletedIds(closed)).toEqual(["menu-a"]);
  expect(deletedIds(opened)).toEqual([]);
});
