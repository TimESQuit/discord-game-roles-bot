import { describe, expect, test } from "vitest";

import { CUSTOM_ID_KINDS, encodeId, isAdminId, parseId } from "./custom-ids.ts";

import type { CustomId } from "./custom-ids.ts";

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
  { kind: "lfg-modal", gameId: 5 },
  { kind: "lfg-in" },
  { kind: "lfg-maybe" },
  { kind: "lfg-role" },
  { kind: "lfg-manage" },
  { kind: "lfg-finish", messageId: "100000000000000950" },
  { kind: "lfg-cancel", messageId: "12345678901234567890" },
  { kind: "close" },
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
  { kind: "uninstall-options" },
  { kind: "uninstall-confirm", choices: 15 },
  { kind: "category-add-modal" },
  { kind: "category-rename-modal", categoryId: 2 },
  { kind: "category-move", categoryId: 2, dir: "up" },
  { kind: "category-move", categoryId: 2, dir: "down" },
  { kind: "category-add" },
  { kind: "category-rename", categoryId: 2 },
];

describe("custom IDs", () => {
  test("the samples cover every kind", () => {
    expect(new Set(samples.map((id) => id.kind))).toEqual(new Set(CUSTOM_ID_KINDS));
  });

  test("every CustomId round-trips and fits 100 chars", () => {
    for (const id of samples) {
      const raw = encodeId(id);
      expect(raw.startsWith("gr:")).toBe(true);
      expect(raw.length).toBeLessThanOrEqual(100);
      expect(parseId(raw)).toEqual(id);
    }
  });

  test("a Cancel button from before the rename to close still closes", () => {
    expect(parseId("gr:cancel")).toEqual({ kind: "close" });
    expect(parseId("gr:cancel:extra")).toBeNull();
  });

  test("a Join this game's role button on a post from before the rename toggles the role", () => {
    expect(parseId("gr:lfg-join")).toEqual({ kind: "lfg-role" });
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
      "gr:lfg-modal:1:news",
      "gr:lfg-finish:abc",
      "gr:lfg-finish:1234",
      "gr:lfg-cancel:123456789012345678901",
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
      "uninstall-options",
      "uninstall-confirm",
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
