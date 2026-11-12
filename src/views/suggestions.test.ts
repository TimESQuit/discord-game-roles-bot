import { ComponentType, MessageFlags } from "discord.js";
import { expect, test } from "vitest";

import { parseId } from "../domain/index.ts";
import {
  allComponents,
  buttonKinds,
  customIdButtons,
  defined,
  findComponents,
  flagBits,
  textOf,
} from "../testing/index.ts";
import {
  announcementView,
  duplicatePromptView,
  mySuggestionsView,
  rejectModal,
  reviewCardView,
  reviewEditModal,
  suggestModal,
} from "./suggestions.ts";

import type { Category, Game, Suggestion } from "../db/index.ts";

const buttons = customIdButtons;
const texts = textOf;

const cats: Category[] = [
  { id: 1, name: "Chill", position: 1 },
  { id: 2, name: "Competitive", position: 2 },
];
const sugg = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 7,
  suggesterId: "100000000000000001",
  name: "Valheim",
  categoryId: 1,
  note: null,
  status: "pending",
  reviewerId: null,
  rejectionReason: null,
  decidedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  reviewMessageId: null,
  gameId: null,
  aliases: null,
  ...over,
});
const game = (id: number, name: string): Game => ({
  id,
  name,
  categoryId: 1,
  roleId: `2000000000000${String(id).padStart(5, "0")}`,
  aliases: [],
  addedBy: "100000000000000001",
  addedAt: "2026-01-01T00:00:00Z",
});

test("review card and announcement never ping", () => {
  const card = reviewCardView(sugg({ name: "@everyone", note: "<@&123>" }), "Chill");
  expect(card.allowedMentions).toEqual({ parse: [] });
  expect(flagBits(card)).toBe(MessageFlags.IsComponentsV2);
  expect("content" in card).toBe(false);
  expect(texts(card)).not.toContain("@everyone");
  expect(announcementView(game(1, "Valheim")).allowedMentions).toEqual({ parse: [] });
  expect(texts(announcementView(game(1, "Valheim")))).toBe(
    "New game: **Valheim** — <@&200000000000000001>",
  );
});

test("pending card has Approve, Edit and Reject with the suggestion ID", () => {
  const ids = buttons(reviewCardView(sugg(), "Chill")).map((b) => parseId(b.custom_id));
  expect(ids).toEqual([
    { kind: "review-approve", suggestionId: 7 },
    { kind: "review-edit", suggestionId: 7 },
    { kind: "review-reject", suggestionId: 7 },
  ]);
});

test("decided card shows who decided and has no buttons", () => {
  const approved = reviewCardView(
    sugg({ status: "approved", reviewerId: "100000000000000002" }),
    "Chill",
  );
  expect(texts(approved)).toContain("Approved by <@100000000000000002>");
  expect(findComponents(approved, ComponentType.Button)).toHaveLength(0);
  const rejected = reviewCardView(
    sugg({ status: "rejected", reviewerId: "100000000000000002", rejectionReason: "too niche" }),
    "Chill",
  );
  expect(texts(rejected)).toContain("Rejected by <@100000000000000002>: too niche");
  expect(findComponents(rejected, ComponentType.Button)).toHaveLength(0);
});

test("card shows the aliases and the note", () => {
  const card = reviewCardView(sugg({ note: "fun co-op", aliases: "vh, valhe" }), "Chill");
  expect(texts(card)).toContain("vh, valhe");
  expect(texts(card)).toContain("fun co-op");
});

test("duplicate prompt: one Join per game (max 5), Submit anyway and Cancel", () => {
  const games = [1, 2, 3, 4, 5, 6, 7].map((i) => game(i, `Game ${String(i)}`));
  const view = duplicatePromptView({ games, pending: [{ id: 3, name: "Valhalla" }] });
  const ids = buttons(view).map((b) => parseId(b.custom_id));
  expect(ids.filter((i) => i?.kind === "dup-join")).toHaveLength(5);
  expect(ids.map((i) => i?.kind).slice(-2)).toEqual(["dup-submit", "close"]);
  expect(texts(view)).toContain("Did you mean");
  expect(texts(view)).toContain("Valhalla");
  expect(flagBits(view)).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
});

test("my suggestions: Withdraw only on pending; rejected shows reason; within 40 components with 10+10", () => {
  const pending = Array.from({ length: 10 }, (_, i) => sugg({ id: i + 1, name: `P${String(i)}` }));
  const decided = Array.from({ length: 14 }, (_, i) =>
    sugg({
      id: 100 + i,
      name: `D${String(i)}`,
      status: i === 13 ? "rejected" : "approved",
      rejectionReason: i === 13 ? "not a game" : null,
    }),
  );
  const view = mySuggestionsView([...pending, ...decided], new Map(cats.map((c) => [c.id, c])));
  expect(buttonKinds(view).filter((kind) => kind === "withdraw")).toHaveLength(10);
  expect(allComponents(view).length).toBeLessThanOrEqual(40);
  expect(texts(view)).toContain("not a game");
  expect(texts(view)).toContain("D4");
  expect(texts(view)).not.toContain("D3");
  expect(flagBits(view)).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
});

test("my suggestions can be closed, with or without suggestions", () => {
  const byId = new Map(cats.map((c) => [c.id, c]));
  expect(buttonKinds(mySuggestionsView([sugg({ id: 1, name: "P" })], byId))).toContain("close");
  expect(buttonKinds(mySuggestionsView([], byId))).toContain("close");
});

test("suggest modal offers every category in the select", () => {
  const modal = suggestModal(cats).toJSON();
  expect(parseId(modal.custom_id)).toEqual({ kind: "suggest-modal" });
  const select = defined(findComponents(modal.components, ComponentType.StringSelect)[0]);
  expect(select.options.map((o) => o.value)).toEqual(["1", "2"]);
  const inputs = findComponents(modal.components, ComponentType.TextInput);
  expect(inputs.map((i) => i.max_length)).toEqual([100, 300]);
  expect(inputs.map((i) => i.required)).toEqual([true, false]);
});

test("review edit modal prefills and marks the current category", () => {
  const modal = reviewEditModal(sugg({ aliases: "vh" }), cats).toJSON();
  expect(parseId(modal.custom_id)).toEqual({ kind: "review-edit-modal", suggestionId: 7 });
  const values = findComponents(modal.components, ComponentType.TextInput).map((n) => n.value);
  expect(values).toEqual(["Valheim", "vh"]);
  const select = defined(findComponents(modal.components, ComponentType.StringSelect)[0]);
  expect(select.options.map((o) => o.default === true)).toEqual([true, false]);
});

test("reject modal needs a reason of at most 300 characters", () => {
  const modal = rejectModal(sugg()).toJSON();
  expect(parseId(modal.custom_id)).toEqual({ kind: "review-reject-modal", suggestionId: 7 });
  const input = defined(findComponents(modal.components, ComponentType.TextInput)[0]);
  expect(input.required).toBe(true);
  expect(input.max_length).toBe(300);
});
