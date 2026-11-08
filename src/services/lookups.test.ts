import { beforeEach, describe, expect, test } from "vitest";

import { MESSAGES } from "../constants.ts";
import { makeContext } from "../testing/index.ts";
import {
  requireCategory,
  requireGame,
  requirePendingSuggestion,
  requireSuggestion,
} from "./lookups.ts";

import type { TestContext } from "../testing/index.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await makeContext();
});

describe("lookups", () => {
  test("missing rows throw the shared messages", async () => {
    await expect(requireGame(ctx, 999)).rejects.toThrow(MESSAGES.gameGone);
    await expect(requireCategory(ctx, 999)).rejects.toThrow(MESSAGES.categoryGone);
    await expect(requireSuggestion(ctx, 999)).rejects.toThrow(MESSAGES.suggestionGone);
    await expect(requirePendingSuggestion(ctx, 999)).rejects.toThrow(MESSAGES.suggestionGone);
  });

  test("pending suggestions pass, decided ones name their status", async () => {
    const category = (await ctx.repos.categories.list())[0];
    if (!category) throw new Error("no category");
    const s = await ctx.repos.suggestions.add({
      suggesterId: "1",
      name: "Valheim",
      categoryId: category.id,
      note: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect((await requirePendingSuggestion(ctx, s.id)).id).toBe(s.id);
    await ctx.repos.suggestions.decide(s.id, "rejected", "2", "2026-01-02T00:00:00Z", "no");
    await expect(requirePendingSuggestion(ctx, s.id)).rejects.toThrow(
      "This suggestion was already rejected.",
    );
  });
});
