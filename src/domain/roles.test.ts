import { expect, test } from "vitest";

import { chunk, computeRoleOrder, diffSelection, hasTiedRolePositions } from "./roles.ts";

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
    .toSorted((a, b) => b[1] - a[1])
    .map(([id]) => id);
  expect(order).toEqual(["member", "tpl", "apex", "zelda", "other"]);
  expect(changes.some((c) => c.id === "member" || c.id === "everyone")).toBe(false);
  expect(changes).toEqual([
    { id: "apex", position: 3 },
    { id: "zelda", position: 2 },
  ]);
});

test("a game role above the template only changes the game role", () => {
  const changes = computeRoleOrder(
    [
      { id: "everyone", position: 0 },
      { id: "g", position: 6 },
      { id: "member", position: 5 },
      { id: "tpl", position: 4 },
    ],
    "tpl",
    ["g"],
  );
  expect(changes).toEqual([{ id: "g", position: 1 }]);
});

test("duplicate game ids do not produce duplicate entries", () => {
  const roles = [
    { id: "tpl", position: 3 },
    { id: "b", position: 2 },
    { id: "a", position: 1 },
  ];
  expect(computeRoleOrder(roles, "tpl", ["a", "b", "a"])).toEqual([
    { id: "a", position: 2 },
    { id: "b", position: 1 },
  ]);
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

test("roles sharing a position at or below the bot's role are detected", () => {
  const roles = [
    { position: 0 }, // @everyone
    { position: 4 },
    { position: 1 }, // the bot's role
    { position: 1 }, // the template
  ];
  expect(hasTiedRolePositions(roles, 1)).toBe(true);
});

test("ties above the bot's role, gaps and @everyone don't count as ties", () => {
  const roles = [
    { position: 0 },
    { position: 9 },
    { position: 9 },
    { position: 5 },
    { position: 2 },
  ];
  expect(hasTiedRolePositions(roles, 5)).toBe(false);
});

test("chunk", () => {
  expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  expect(chunk([], 25)).toEqual([]);
  expect(() => chunk([1], 0)).toThrow(RangeError);
});
