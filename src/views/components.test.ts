import { MessageFlags } from "discord.js";
import { expect, test } from "vitest";

import { PEOPLE_SHOWN_MAX, TEXT_DISPLAY_LIMIT } from "../constants.ts";
import { button, display, payload, shownPeople } from "./components.ts";

test("display truncates to the text display limit", () => {
  expect(display("x".repeat(TEXT_DISPLAY_LIMIT + 5)).content).toHaveLength(TEXT_DISPLAY_LIMIT);
});

test("button only carries disabled when true", () => {
  expect(button({ kind: "cancel" }, "Cancel")).not.toHaveProperty("disabled");
  expect(button({ kind: "cancel" }, "Cancel", undefined, true)).toHaveProperty("disabled", true);
});

test("payload sets flags and blocks pings", () => {
  const pub = payload([display("hi")], false);
  const priv = payload([display("hi")], true);
  expect(pub.flags).toEqual([MessageFlags.IsComponentsV2]);
  expect(priv.flags).toEqual([MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
  expect(pub.allowedMentions).toEqual({ parse: [] });
});

test("shownPeople caps mentions and reports the rest", () => {
  const ids = Array.from({ length: PEOPLE_SHOWN_MAX + 3 }, (_, i) => String(i));
  const { mentions, more } = shownPeople(ids);
  expect(mentions).toHaveLength(PEOPLE_SHOWN_MAX);
  expect(mentions[0]).toBe("<@0>");
  expect(more).toBe("…and 3 more");
  expect(shownPeople(["1"])).toEqual({ mentions: ["<@1>"], more: null });
});
