import { describe, expect, test } from "vitest";
import { encodeId, isAdminId, parseId, type CustomId } from "../../src/interactions/custom-ids.ts";

const samples: CustomId[] = [
  { kind: "panel-open" },
  { kind: "menu", action: "add" },
  { kind: "menu", action: "remove" },
  { kind: "menu", action: "suggest" },
  { kind: "menu", action: "mine" },
  { kind: "menu", action: "who" },
  { kind: "menu", action: "mysug" },
  { kind: "menu", action: "lfg" },
  { kind: "add-select", categoryId: 3, chunk: 1 },
  { kind: "add-page", page: 2 },
  { kind: "remove-select", chunk: 0 },
  { kind: "pick", purpose: "who", categoryId: 4, chunk: 0 },
  { kind: "pick", purpose: "lfg", categoryId: 4, chunk: 0 },
  { kind: "pick", purpose: "edit", categoryId: 4, chunk: 0 },
  { kind: "pick", purpose: "remove", categoryId: 4, chunk: 0 },
  { kind: "pick-page", purpose: "who", page: 1 },
  { kind: "pick-page", purpose: "lfg", page: 1 },
  { kind: "pick-page", purpose: "edit", page: 1 },
  { kind: "pick-page", purpose: "remove", page: 1 },
  { kind: "suggest-modal" },
  { kind: "dup-submit" },
  { kind: "dup-join", gameId: 7 },
  { kind: "withdraw", suggestionId: 9 },
  { kind: "lfg-modal", gameId: 5, target: "news" },
  { kind: "lfg-modal", gameId: 5, target: "here" },
  { kind: "lfg-in" },
  { kind: "lfg-maybe" },
  { kind: "lfg-join" },
  { kind: "cancel" },
  { kind: "admin", action: "review" },
  { kind: "admin", action: "add" },
  { kind: "admin", action: "edit" },
  { kind: "admin", action: "remove" },
  { kind: "admin", action: "categories" },
  { kind: "admin", action: "reapply" },
  { kind: "admin", action: "refresh" },
  { kind: "admin", action: "backup" },
  { kind: "admin", action: "setup" },
  { kind: "review-approve", suggestionId: 1 },
  { kind: "review-edit", suggestionId: 1 },
  { kind: "review-reject", suggestionId: 1 },
  { kind: "review-edit-modal", suggestionId: 1 },
  { kind: "review-reject-modal", suggestionId: 1 },
  { kind: "game-add-modal" },
  { kind: "game-edit-modal", gameId: 12 },
  { kind: "confirm-remove", gameId: 12 },
  { kind: "confirm-setup" },
  { kind: "category-add-modal" },
  { kind: "category-rename-modal", categoryId: 2 },
  { kind: "category-move", categoryId: 2, dir: "up" },
  { kind: "category-move", categoryId: 2, dir: "down" },
  { kind: "category-add" },
  { kind: "category-rename", categoryId: 2 },
];

describe("custom IDs", () => {
  test("every CustomId round-trips and fits 100 chars", () => {
    for (const id of samples) {
      const raw = encodeId(id);
      expect(raw.startsWith("gr:")).toBe(true);
      expect(raw.length).toBeLessThanOrEqual(100);
      expect(parseId(raw)).toEqual(id);
    }
  });

  test("foreign or malformed IDs parse to null", () => {
    for (const raw of [
      "other:1",
      "",
      "gr:",
      "gr:nope",
      "gr:add-select:x:0",
      "gr:add-select:1",
      "gr:add-select:1:0:9",
      "gr:add-select:1.5:0",
      "gr:add-select:-1:0",
      "gr:menu:bogus",
      "gr:pick:what:1:0",
      "gr:category-move:1:sideways",
      "gr:lfg-modal:1:elsewhere",
      "gr:panel-open:extra",
      `gr:menu:add${"x".repeat(100)}`,
      `gr:add-page:${"1".repeat(100)}`,
    ]) {
      expect(parseId(raw)).toBeNull();
    }
  });

  test("isAdminId follows the admin list", () => {
    const admin = new Set([
      "admin",
      "review-approve",
      "review-edit",
      "review-reject",
      "review-edit-modal",
      "review-reject-modal",
      "game-add-modal",
      "game-edit-modal",
      "confirm-remove",
      "confirm-setup",
      "category-add-modal",
      "category-rename-modal",
      "category-move",
      "category-add",
      "category-rename",
    ]);
    for (const id of samples) {
      const expected =
        admin.has(id.kind) ||
        ((id.kind === "pick" || id.kind === "pick-page") &&
          ["edit", "remove"].includes(id.purpose));
      expect(isAdminId(id)).toBe(expected);
    }
  });
});
