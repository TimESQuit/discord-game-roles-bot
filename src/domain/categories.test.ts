import { expect, test } from "vitest";

import { UserFacingError } from "../errors.ts";
import { validateCategoryName } from "./categories.ts";

const existing = [
  { id: 1, name: "Chill" },
  { id: 2, name: "Competitive" },
];

test("trims the name", () => {
  expect(validateCategoryName("  Co-op  ", existing)).toBe("Co-op");
});

test("refuses an empty name", () => {
  expect(() => validateCategoryName("   ", existing)).toThrow("Give the category a name.");
  expect(() => validateCategoryName("", existing)).toThrow(UserFacingError);
});

test("refuses more than 50 characters, accepts exactly 50", () => {
  expect(validateCategoryName("a".repeat(50), existing)).toHaveLength(50);
  expect(() => validateCategoryName("a".repeat(51), existing)).toThrow(
    "Category names can be at most 50 characters.",
  );
});

test("refuses a taken name, ignoring case", () => {
  expect(() => validateCategoryName("cHILL", existing)).toThrow(
    "There's already a category called cHILL.",
  );
});

test("a category may keep or re-case its own name", () => {
  expect(validateCategoryName("chill", existing, 1)).toBe("chill");
  expect(() => validateCategoryName("chill", existing, 2)).toThrow(UserFacingError);
});

test("error messages escape the name", () => {
  expect(() => validateCategoryName("*x*", [{ id: 1, name: "*X*" }])).toThrow(
    "There's already a category called \\*x\\*.",
  );
});
