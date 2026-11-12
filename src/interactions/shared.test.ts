import { beforeEach, describe, expect, test } from "vitest";

import { addGame, removeGame } from "../services/index.ts";
import { A1, defined, makeContext } from "../testing/index.ts";
import { choices, roleNotice, resolvePickedGame } from "./shared.ts";

import type { TestContext } from "../testing/index.ts";

let ctx: TestContext;
let gameId: number;

beforeEach(async () => {
  ctx = await makeContext();
  const cats = await ctx.repos.categories.list();
  gameId = (
    await addGame(ctx, {
      name: "Valheim",
      categoryId: defined(cats[1]).id,
      aliases: "",
      actorId: A1,
    })
  ).id;
});

describe("resolvePickedGame", () => {
  test("returns the game for a good id", async () => {
    expect((await resolvePickedGame(ctx, String(gameId))).name).toBe("Valheim");
  });
  test("a deleted game is reported", async () => {
    await removeGame(ctx, gameId, A1);
    await expect(resolvePickedGame(ctx, String(gameId))).rejects.toThrow(
      "That game no longer exists.",
    );
  });
});

test("roleNotice escapes the name", () => {
  expect(roleNotice("joined", "*Doom*")).toContain("\\*Doom\\*");
});

test("choices cut long names and send the ID", () => {
  expect(choices([{ id: 3, name: "x".repeat(150) }])).toEqual([
    { name: `${"x".repeat(99)}…`, value: "3" },
  ]);
});
