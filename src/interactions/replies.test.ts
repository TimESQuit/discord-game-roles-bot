import { ButtonInteraction, MessageFlags, MessageFlagsBitField } from "discord.js";
import { expect, test } from "vitest";

import { flagBits, textOf } from "../testing/index.ts";
import { noticeView } from "../views/index.ts";
import { PRIVATE_V2_DEFER, forEdit, forReply, noticePrivately, updateWith } from "./replies.ts";

import type { InteractionEditReplyOptions } from "discord.js";

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

/** A real ButtonInteraction prototype whose defer and edit calls are recorded. */
function fakeButton(log: string[]): ButtonInteraction {
  const made: unknown = Object.create(ButtonInteraction.prototype);
  if (!(made instanceof ButtonInteraction)) throw new Error("Could not build a fake interaction");
  return Object.assign(made, {
    deferUpdate: async () => void log.push("deferUpdate"),
    deferReply: async () => void log.push("deferReply"),
    editReply: async (options: InteractionEditReplyOptions) =>
      void log.push(`editReply:${textOf(options.components ?? [])}`),
  });
}

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
