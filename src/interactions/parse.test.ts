import { expect, test } from "vitest";

import { parseCategoryId, parseGameId, parsePositiveId } from "./parse.ts";

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
