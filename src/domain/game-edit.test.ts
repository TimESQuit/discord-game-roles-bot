import { expect, test } from "vitest";

import { diffGameEdit } from "./game-edit.ts";

import type { Game } from "../db/index.ts";

const game: Game = {
  id: 4,
  name: "Valheim",
  categoryId: 2,
  roleId: "100000000000000900",
  aliases: ["viking", "valh"],
  addedBy: "100000000000000011",
  addedAt: "2026-01-01T00:00:00Z",
};

test("unchanged prefilled values give an empty patch", () => {
  expect(diffGameEdit(game, { name: "Valheim", categoryId: 2, aliases: "viking, valh" })).toEqual(
    {},
  );
});

test("only changed fields are in the patch", () => {
  expect(diffGameEdit(game, { name: "Valheim 2", categoryId: 2, aliases: "viking, valh" })).toEqual(
    {
      name: "Valheim 2",
    },
  );
  expect(diffGameEdit(game, { name: "Valheim", categoryId: 3, aliases: "viking, valh" })).toEqual({
    categoryId: 3,
  });
  expect(diffGameEdit(game, { name: "Valheim", categoryId: 2, aliases: "viking" })).toEqual({
    aliases: "viking",
  });
});

test("aliases compare without regard to order, case or spacing", () => {
  expect(diffGameEdit(game, { aliases: " Valh ,VIKING" })).toEqual({});
});

test("omitted fields are not compared", () => {
  expect(diffGameEdit(game, {})).toEqual({});
  expect(diffGameEdit(game, { name: "Other" })).toEqual({ name: "Other" });
});

test("extra whitespace in the name is not a change", () => {
  expect(diffGameEdit(game, { name: "  Valheim " })).toEqual({});
});
