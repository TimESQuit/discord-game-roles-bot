import { MessageFlags } from "discord.js";
import { expect, test } from "vitest";
import { flagBits } from "../testing/index.ts";
import { noticeView } from "../views/index.ts";
import { PRIVATE_V2_DEFER, forEdit, forReply } from "./replies.ts";

test("the defer flags string is Ephemeral | IsComponentsV2", () => {
  expect(Number(PRIVATE_V2_DEFER)).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
});

test("a private view replies privately and edits keep only the layout flag", () => {
  const view = noticeView("hello");
  expect(forReply(view).flags).toBe(view.flags);
  expect(flagBits(view)).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
  expect(forReply(view).components).toBe(view.components);
  expect(forEdit(view).flags).toBe(MessageFlags.IsComponentsV2);
  expect(forEdit(view).components).toBe(view.components);
});
