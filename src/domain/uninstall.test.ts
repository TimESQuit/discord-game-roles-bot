import { expect, test } from "vitest";

import {
  UNINSTALL_OPTIONS,
  choicesFromBits,
  choicesFromValues,
  choicesToBits,
} from "./uninstall.ts";

test("every combination of choices survives the round trip through a custom ID number", () => {
  for (let bits = 0; bits < 2 ** UNINSTALL_OPTIONS.length; bits++) {
    expect(choicesToBits(choicesFromBits(bits))).toBe(bits);
  }
});

test("no choices means delete everything and stay", () => {
  expect([...choicesFromBits(0)]).toEqual([]);
});

test("unknown select values are ignored", () => {
  expect([...choicesFromValues(["keepRoles", "nonsense", "leave"])]).toEqual([
    "keepRoles",
    "leave",
  ]);
});

test("bits beyond the known options are ignored", () => {
  expect(choicesToBits(choicesFromBits(2 ** 10 + 1))).toBe(1);
});
