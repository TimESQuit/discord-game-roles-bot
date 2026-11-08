import { expect, test } from "vitest";

import { parsePositiveId } from "./parse.ts";

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
