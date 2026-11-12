import { expect, test } from "vitest";

import { UserFacingError } from "../errors.ts";
import { validateGameName } from "./games.ts";

test("validateGameName", () => {
  expect(validateGameName("  Deep   Rock  ")).toBe("Deep Rock");
  expect(() => validateGameName("!!!")).toThrow(UserFacingError);
  expect(() => validateGameName("x".repeat(101))).toThrow(/100/);
});
