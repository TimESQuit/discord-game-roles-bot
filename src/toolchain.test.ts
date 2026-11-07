import { expect, test } from "vitest";
import { STARTING_CATEGORIES, MAX_PENDING_SUGGESTIONS } from "./constants.ts";

test("runs on Node 26+", () => {
  expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(26);
});

test("constants match the spec", () => {
  expect(STARTING_CATEGORIES).toEqual(["Competitive", "Chill", "IRL activities"]);
  expect(MAX_PENDING_SUGGESTIONS).toBe(10);
});
