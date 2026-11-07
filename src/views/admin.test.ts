import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { expect, test } from "vitest";
import type { Category, Game, Suggestion } from "../db/types.ts";
import { parseId } from "../interactions/custom-ids.ts";
import {
  categoriesView,
  categoryModal,
  confirmRemoveView,
  gameModal,
  reviewListView,
  setupPreviewView,
  setupReportView,
} from "./admin.ts";
import { countComponents } from "./limits.ts";

type Node = { type: number; components?: Node[]; component?: Node; [key: string]: unknown };
const json = (p: { components?: unknown }): Node[] => {
  const items = (p.components ?? []) as { toJSON?: () => Node }[];
  return items.map((c) => (typeof c.toJSON === "function" ? c.toJSON() : (c as unknown as Node)));
};
const walk = (nodes: Node[]): Node[] =>
  nodes.flatMap((n) => [n, ...walk(n.components ?? (n.component ? [n.component] : []))]);
const all = (p: { components?: unknown }) => walk(json(p));
const buttons = (p: { components?: unknown }) =>
  all(p).filter((n) => n.type === ComponentType.Button);
const texts = (p: { components?: unknown }) =>
  all(p)
    .filter((n) => n.type === ComponentType.TextDisplay)
    .map((n) => String(n.content))
    .join("\n");
const kinds = (p: { components?: unknown }) =>
  buttons(p).map((b) => parseId(String(b.custom_id))?.kind);

const cat = (id: number, name: string): Category => ({ id, name, position: id });
const game: Game = {
  id: 4,
  name: "Valheim",
  categoryId: 2,
  roleId: "100000000000000900",
  aliases: ["viking", "valh"],
  addedBy: "100000000000000011",
  addedAt: "2026-01-01T00:00:00Z",
};
const sugg = (id: number): Suggestion => ({
  id,
  suggesterId: "100000000000000001",
  name: `Game ${String(id)}`,
  categoryId: 1,
  note: "please",
  status: "pending",
  reviewerId: null,
  rejectionReason: null,
  decidedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  reviewMessageId: null,
  gameId: null,
  aliases: null,
});

test("setup preview disables Confirm when there are problems", () => {
  const view = setupPreviewView(["Give the bot the Manage Roles permission."], {
    create: ["templateRole"],
    fine: [],
  });
  const confirm = buttons(view).find((b) => parseId(String(b.custom_id))?.kind === "confirm-setup");
  expect(confirm?.disabled).toBe(true);
  const body = texts(view);
  expect(body.indexOf("Manage Roles")).toBeLessThan(body.indexOf("Will create"));
});

test("setup preview enables Confirm when there is something to create", () => {
  const view = setupPreviewView([], {
    create: ["newsChannel", "categories"],
    fine: ["logChannel"],
  });
  const confirm = buttons(view).find((b) => parseId(String(b.custom_id))?.kind === "confirm-setup");
  expect(confirm?.disabled).toBeFalsy();
  expect(texts(view)).toContain("Will create:");
  expect(texts(view)).toContain("#game-news");
  expect(texts(view)).toContain("Already fine:");
  expect(view.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
});

test("setup preview disables Confirm when nothing needs creating", () => {
  const view = setupPreviewView([], { create: [], fine: ["templateRole"] });
  const confirm = buttons(view).find((b) => parseId(String(b.custom_id))?.kind === "confirm-setup");
  expect(confirm?.disabled).toBe(true);
});

test("setup report lists created and fine items plus the reminder", () => {
  const view = setupReportView({ created: ["templateRole"], fine: ["newsChannel"] });
  expect(texts(view)).toContain("Created: ");
  expect(texts(view)).toContain("Already fine: ");
  expect(texts(view)).toContain(
    "Next: set the template role's color, and add a healthchecks.io webhook in #bot-admin.",
  );
});

test("remove confirmation states the member count", () => {
  const view = confirmRemoveView(game, 3);
  expect(texts(view)).toContain("Remove Valheim? 3 members will lose the role.");
  expect(texts(confirmRemoveView(game, 1))).toContain("1 member will lose the role.");
  const confirm = buttons(view).find((b) => b.style === ButtonStyle.Danger);
  expect(parseId(String(confirm?.custom_id))).toEqual({ kind: "confirm-remove", gameId: 4 });
  expect(kinds(view)).toContain("cancel");
});

test("categories view: no Up on first, no Down on last", () => {
  const view = categoriesView([cat(1, "A"), cat(2, "B"), cat(3, "C")]);
  const moves = buttons(view)
    .map((b) => parseId(String(b.custom_id)))
    .filter((id) => id?.kind === "category-move");
  expect(moves).toEqual([
    { kind: "category-move", categoryId: 1, dir: "down" },
    { kind: "category-move", categoryId: 2, dir: "up" },
    { kind: "category-move", categoryId: 2, dir: "down" },
    { kind: "category-move", categoryId: 3, dir: "up" },
  ]);
  expect(kinds(view).filter((k) => k === "category-rename")).toHaveLength(3);
  expect(kinds(view).at(-1)).toBe("category-add");
});

test("categories view stays within 40 components and points to the command", () => {
  const view = categoriesView(Array.from({ length: 12 }, (_, i) => cat(i + 1, `C${String(i)}`)));
  expect(countComponents(view)).toBeLessThanOrEqual(40);
  expect(texts(view)).toContain("/gameadmin category");
  expect(kinds(view).at(-1)).toBe("category-add");
});

test("review list caps at 40 components and says how many more", () => {
  const pending = Array.from({ length: 10 }, (_, i) => sugg(i + 1));
  const view = reviewListView(pending, new Map([[1, cat(1, "Chill")]]));
  expect(countComponents(view)).toBeLessThanOrEqual(40);
  expect(texts(view)).toContain("…and 3 more in #bot-admin");
  expect(kinds(view).filter((k) => k === "review-approve")).toHaveLength(7);
  expect(view.allowedMentions).toEqual({ parse: [] });
});

test("review list with nothing pending says so", () => {
  expect(texts(reviewListView([], new Map()))).toContain("No suggestions waiting for review.");
});

test("review list shows no 'more' line when everything fits", () => {
  const view = reviewListView([sugg(1), sugg(2)], new Map([[1, cat(1, "Chill")]]));
  expect(texts(view)).not.toContain("more in #bot-admin");
});

test("game modal: add is empty, edit is prefilled", () => {
  const cats = [cat(1, "Chill"), cat(2, "Competitive")];
  const add = gameModal(cats).toJSON();
  expect(parseId(add.custom_id)).toEqual({ kind: "game-add-modal" });
  const edit = gameModal(cats, game).toJSON();
  expect(parseId(edit.custom_id)).toEqual({ kind: "game-edit-modal", gameId: 4 });
  const fields = walk(edit.components as unknown as Node[]);
  expect(fields.find((n) => n.custom_id === "name")?.value).toBe("Valheim");
  expect(fields.find((n) => n.custom_id === "aliases")?.value).toBe("viking, valh");
  const select = fields.find((n) => n.custom_id === "category") as unknown as {
    options: { value: string; default?: boolean }[];
  };
  expect(select.options.find((o) => o.default)?.value).toBe("2");
});

test("category modal: one name field of at most 50, prefilled on rename", () => {
  const add = categoryModal().toJSON();
  expect(parseId(add.custom_id)).toEqual({ kind: "category-add-modal" });
  const rename = categoryModal(cat(2, "Chill")).toJSON();
  expect(parseId(rename.custom_id)).toEqual({ kind: "category-rename-modal", categoryId: 2 });
  const input = walk(rename.components as unknown as Node[]).find((n) => n.custom_id === "name");
  expect(input?.value).toBe("Chill");
  expect(input?.max_length).toBe(50);
});

test("game modal: long aliases raise the max length instead of being cut", () => {
  const long = { ...game, aliases: Array.from({ length: 60 }, (_, i) => `alias${String(i)}`) };
  const joined = long.aliases.join(", ");
  expect(joined.length).toBeGreaterThan(300);
  const fields = walk(gameModal([cat(2, "A")], long).toJSON().components as unknown as Node[]);
  const aliases = fields.find((n) => n.custom_id === "aliases");
  expect(aliases?.value).toBe(joined);
  expect(aliases?.max_length).toBe(joined.length);
});

test("game modal: aliases beyond 4000 characters are left out with a pointer to the command", () => {
  const huge = { ...game, aliases: Array.from({ length: 700 }, (_, i) => `alias${String(i)}`) };
  const json = JSON.stringify(gameModal([cat(2, "A")], huge).toJSON());
  expect(json).not.toContain('"custom_id":"aliases"');
  expect(json).toContain("Edit aliases with /gameadmin edit");
});

test("game modal: the game's current category is offered even beyond the first 25", () => {
  const many = Array.from({ length: 30 }, (_, i) => cat(i + 1, `C${String(i)}`));
  const fields = walk(
    gameModal(many, { ...game, categoryId: 29 }).toJSON().components as unknown as Node[],
  );
  const select = fields.find((n) => n.custom_id === "category") as unknown as {
    options: { value: string; default?: boolean }[];
  };
  expect(select.options).toHaveLength(25);
  expect(select.options.find((o) => o.default)?.value).toBe("29");
});

test("review list keeps total text within 4000 characters", () => {
  const big = (id: number): Suggestion => ({
    ...sugg(id),
    name: "N".repeat(100),
    note: "n".repeat(300),
    aliases: "a".repeat(300),
  });
  const view = reviewListView(
    Array.from({ length: 7 }, (_, i) => big(i + 1)),
    new Map([[1, cat(1, "C".repeat(50))]]),
  );
  const total = all(view)
    .filter((n) => n.type === ComponentType.TextDisplay)
    .reduce((sum, n) => sum + String(n.content).length, 0);
  expect(total).toBeLessThanOrEqual(4000);
  expect(texts(view)).toMatch(/…and \d+ more in #bot-admin/);
  expect(countComponents(view)).toBeLessThanOrEqual(40);
});
