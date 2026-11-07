import { expect, test } from "vitest";
import { UserFacingError } from "../../src/errors.ts";
import {
  chunk,
  computeRoleOrder,
  diffSelection,
  isAdmin,
  validateGameName,
} from "../../src/domain/roles.ts";

test("diff only touches roles shown in that dropdown", () => {
  const shown = ["a", "b", "c"];
  const current = new Set(["a", "x"]); // x is another category's role
  expect(diffSelection(shown, current, ["b"])).toEqual({ add: ["b"], remove: ["a"] });
});

test("selections not shown (stale or forged) are ignored", () => {
  expect(diffSelection(["a"], new Set(), ["a", "zzz"])).toEqual({ add: ["a"], remove: [] });
});

test("empty selection removes all shown roles the member has", () => {
  expect(diffSelection(["a", "b"], new Set(["a", "b"]), [])).toEqual({
    add: [],
    remove: ["a", "b"],
  });
});

test("game roles go directly below the template, A→Z, top to bottom", () => {
  const roles = [
    { id: "everyone", position: 0 },
    { id: "member", position: 5 },
    { id: "tpl", position: 4 },
    { id: "zelda", position: 3 },
    { id: "other", position: 2 },
    { id: "apex", position: 1 },
  ];
  const changes = computeRoleOrder(roles, "tpl", ["apex", "zelda"]);
  const after = new Map(roles.map((r) => [r.id, r.position]));
  for (const c of changes) after.set(c.id, c.position);
  const order = [...after]
    .filter(([id]) => id !== "everyone")
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  expect(order).toEqual(["member", "tpl", "apex", "zelda", "other"]);
  expect(changes.some((c) => c.id === "member" || c.id === "everyone")).toBe(false);
});

test("already sorted → no changes", () => {
  expect(
    computeRoleOrder(
      [
        { id: "tpl", position: 3 },
        { id: "a", position: 2 },
        { id: "b", position: 1 },
      ],
      "tpl",
      ["a", "b"],
    ),
  ).toEqual([]);
});

test("chunk", () => {
  expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  expect(chunk([], 25)).toEqual([]);
});

test("isAdmin", () => {
  expect(isAdmin(new Set(["r1"]), "r1")).toBe(true);
  expect(isAdmin(new Set(), "r1")).toBe(false);
});

test("validateGameName", () => {
  expect(validateGameName("  Deep   Rock  ")).toBe("Deep Rock");
  expect(() => validateGameName("!!!")).toThrow(UserFacingError);
  expect(() => validateGameName("x".repeat(101))).toThrow(/100/);
});
