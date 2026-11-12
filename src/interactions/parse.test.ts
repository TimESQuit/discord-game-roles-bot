import { InteractionType } from "discord.js";
import { describe, expect, test } from "vitest";

import { MESSAGES } from "../constants.ts";
import { idOf, parseCategoryId, parseGameId, parsePositiveId } from "./parse.ts";

test("accepts a plain positive integer, trimmed", () => {
  expect(parsePositiveId(" 12 ", "bad")).toBe(12);
});

test.each(["", "0", "-1", "1.5", "1e3", "abc", "1234567890123456", " "])(
  "refuses %j with the given message",
  (raw) => {
    expect(() => parsePositiveId(raw, "Pick one.")).toThrow("Pick one.");
  },
);

test("refuses undefined", () => {
  expect(() => parsePositiveId(undefined, "Pick one.")).toThrow("Pick one.");
});

test("game and category IDs refuse with their own messages", () => {
  expect(parseGameId("7")).toBe(7);
  expect(parseCategoryId("8")).toBe(8);
  expect(() => parseGameId("0")).toThrow("Pick a game from the list.");
  expect(() => parseCategoryId("")).toThrow("Pick a category from the list.");
});

const button = (customId: string) => ({ customId, type: InteractionType.MessageComponent });
const modal = (customId: string) => ({ customId, type: InteractionType.ModalSubmit });

describe("idOf", () => {
  test("returns the parsed ID when it is one of the kinds", () => {
    expect(idOf(button("gr:confirm-remove:3"), "confirm-remove")).toEqual({
      kind: "confirm-remove",
      gameId: 3,
    });
    expect(idOf(button("gr:lfg-cancel:200000000000000001"), "lfg-finish", "lfg-cancel").kind).toBe(
      "lfg-cancel",
    );
  });

  test("another kind or a foreign ID is a stale menu, or a stale form for a modal", () => {
    expect(() => idOf(button("gr:confirm-remove:3"), "withdraw")).toThrow(MESSAGES.menuExpired);
    expect(() => idOf(button("not-ours"), "withdraw")).toThrow(MESSAGES.menuExpired);
    expect(() => idOf(modal("gr:lfg-modal:x"), "lfg-modal")).toThrow(MESSAGES.formExpired);
  });
});
