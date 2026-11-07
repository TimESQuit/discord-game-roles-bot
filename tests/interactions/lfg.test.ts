import { beforeEach, describe, expect, test } from "vitest";
import { resolvePickedGame } from "../../src/interactions/lfg.ts";
import { addGame, removeGame } from "../../src/services/games.ts";
import { A1, makeContext } from "../fakes/context.ts";
import type { TestContext } from "../fakes/context.ts";

let ctx: TestContext;
let gameId: number;

beforeEach(async () => {
  ctx = await makeContext();
  const cats = await ctx.repos.categories.list();
  gameId = (
    await addGame(ctx, { name: "Valheim", categoryId: cats[1]!.id, aliases: "", actorId: A1 })
  ).id;
});

describe("resolvePickedGame", () => {
  test("returns the game for a good id", async () => {
    expect((await resolvePickedGame(ctx, String(gameId))).name).toBe("Valheim");
  });
  test.each(["", " ", "-3", "1.5", "0", "abc"])("rejects %j as not from the list", async (raw) => {
    await expect(resolvePickedGame(ctx, raw)).rejects.toThrow("Pick a game from the list.");
  });
  test("a deleted game is reported", async () => {
    await removeGame(ctx, gameId, A1);
    await expect(resolvePickedGame(ctx, String(gameId))).rejects.toThrow(
      "That game no longer exists.",
    );
  });
});
