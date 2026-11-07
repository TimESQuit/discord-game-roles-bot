import { ComponentType, MessageFlags } from "discord.js";
import { expect, test } from "vitest";
import type { Category, Game } from "../db/index.ts";
import { parseId } from "../domain/index.ts";
import { countComponents, truncate } from "./limits.ts";
import {
  addGamesPageCount,
  addGamesView,
  changedOptionIds,
  pickGamePageCount,
  gameListView,
  menuView,
  myGamesView,
  panelView,
  peopleListView,
  pickGameView,
  removeGamesView,
} from "./member.ts";

type Node = { type: number; components?: Node[]; [key: string]: unknown };
const json = (p: { components?: unknown }): Node[] => {
  const items = (p.components ?? []) as { toJSON?: () => Node }[];
  return items.map((c) => (typeof c.toJSON === "function" ? c.toJSON() : (c as unknown as Node)));
};
const walk = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...walk(n.components ?? [])]);
const all = (p: { components?: unknown }) => walk(json(p));
const allSelects = (p: { components?: unknown }) =>
  all(p).filter((n) => n.type === ComponentType.StringSelect);
const buttons = (p: { components?: unknown }) =>
  all(p).filter((n) => n.type === ComponentType.Button);
const texts = (p: { components?: unknown }) =>
  all(p)
    .filter((n) => n.type === ComponentType.TextDisplay)
    .map((n) => String(n.content))
    .join("\n");

const cat = (id: number, name: string): Category => ({ id, name, position: id });
const game = (id: number, name: string, categoryId: number): Game => ({
  id,
  name,
  categoryId,
  roleId: `2000000000000${String(id).padStart(5, "0")}`,
  aliases: [],
  addedBy: "100000000000000001",
  addedAt: "2026-01-01T00:00:00Z",
});

const chill = cat(1, "Chill");

test("panel view has exactly one button with panel-open ID", () => {
  const p = panelView();
  expect(p.flags).toBeDefined();
  expect(Number(p.flags) & MessageFlags.IsComponentsV2).toBeTruthy();
  expect(p.content).toBeUndefined();
  expect(buttons(p)).toHaveLength(1);
  expect(buttons(p)[0]!.custom_id).toBe("gr:panel-open");
  expect(buttons(p)[0]!.label).toBe("Open game roles");
  expect(p.allowedMentions).toEqual({ parse: [] });
});

test("menu: 7 member buttons; admin row only for admins", () => {
  const member = menuView({ isAdmin: false });
  expect(buttons(member)).toHaveLength(7);
  expect(Number(member.flags) & MessageFlags.Ephemeral).toBeTruthy();
  expect(Number(member.flags) & MessageFlags.IsComponentsV2).toBeTruthy();
  const admin = menuView({ isAdmin: true });
  expect(buttons(admin)).toHaveLength(16);
  for (const p of [member, admin]) {
    for (const row of all(p).filter((n) => n.type === ComponentType.ActionRow)) {
      expect(row.components!.length).toBeLessThanOrEqual(5);
    }
    for (const b of buttons(p)) expect(parseId(String(b.custom_id))).not.toBeNull();
    expect(countComponents(p)).toBeLessThanOrEqual(40);
  }
  expect(buttons(admin).map((b) => b.label)).toContain("Run setup");
});

test("empty category renders text, never a select with 0 options", () => {
  const p = addGamesView([chill], [], new Set(), 0);
  expect(allSelects(p)).toHaveLength(0);
  expect(texts(p)).toContain("_No games yet._");
});

test("category with 30 games gives two selects of 25 and 5, owned pre-ticked", () => {
  const games = Array.from({ length: 30 }, (_, i) =>
    game(i + 1, `Game ${String(i + 10)}`, chill.id),
  );
  const owned = new Set([games[0]!.roleId, games[29]!.roleId]);
  const p = addGamesView([chill], games, owned, 0);
  const selects = allSelects(p);
  expect(selects).toHaveLength(2);
  const options = selects.map((s) => s.options as { default?: boolean; value: string }[]);
  expect(options.map((o) => o.length)).toEqual([25, 5]);
  expect(selects.map((s) => s.max_values)).toEqual([25, 5]);
  expect(selects.every((s) => s.min_values === 0)).toBe(true);
  expect(options[0]![0]!.default).toBe(true);
  expect(options[1]![4]!.default).toBe(true);
  expect(options.flat().filter((o) => o.default)).toHaveLength(2);
  expect(parseId(String(selects[1]!.custom_id))).toEqual({
    kind: "add-select",
    categoryId: 1,
    chunk: 1,
  });
});

test("12 categories x 25 games stays at 40 components per page and pages", () => {
  const categories = Array.from({ length: 12 }, (_, i) => cat(i + 1, `Category ${String(i + 1)}`));
  const games = categories.flatMap((c) =>
    Array.from({ length: 25 }, (_, i) => game(c.id * 100 + i, `G${String(i)} of ${c.name}`, c.id)),
  );
  const count = addGamesPageCount(categories, games);
  expect(count).toBeGreaterThan(1);
  const pages = Array.from({ length: count }, (_, i) =>
    addGamesView(categories, games, new Set(), i),
  );
  for (const p of pages) expect(countComponents(p)).toBeLessThanOrEqual(40);
  expect(pages.flatMap(allSelects)).toHaveLength(12);
  const ids = pages.flatMap(buttons).map((b) => parseId(String(b.custom_id)));
  expect(ids).toContainEqual({ kind: "add-page", page: 1 });
});

test("a single page has no pager; the notice shows at the top", () => {
  const p = addGamesView([chill], [game(1, "Minecraft", 1)], new Set(), 0, "Added Minecraft.");
  expect(buttons(p)).toHaveLength(0);
  expect(texts(p).startsWith("Added Minecraft.")).toBe(true);
});

test("labels and option text are truncated to 100 chars", () => {
  const long = "x".repeat(150);
  const p = addGamesView([chill], [game(1, long, 1)], new Set(), 0);
  const opt = (allSelects(p)[0]!.options as { label: string }[])[0]!;
  expect(opt.label).toHaveLength(100);
  expect(opt.label.endsWith("…")).toBe(true);
  expect(truncate("short", 100)).toBe("short");
  expect(truncate("abcdef", 4)).toBe("abc…");
  const emoji = "ab😀😀😀";
  expect(truncate(emoji, 4)).toBe("ab😀…");
  expect(truncate(emoji, 5)).toBe(emoji);
});

test("remove view: nothing pre-ticked, chunks of 25; empty shows text", () => {
  const games = Array.from({ length: 30 }, (_, i) => game(i + 1, `G${String(i + 10)}`, 1));
  const p = removeGamesView(games);
  const selects = allSelects(p);
  expect(selects.map((s) => (s.options as unknown[]).length)).toEqual([25, 5]);
  expect(selects.flatMap((s) => s.options as { default?: boolean }[]).some((o) => o.default)).toBe(
    false,
  );
  const empty = removeGamesView([]);
  expect(allSelects(empty)).toHaveLength(0);
  expect(texts(empty)).toContain("You haven't picked any games yet.");
});

test("my games lists names with Add and Remove buttons; empty text", () => {
  const p = myGamesView([game(1, "Minecraft", 1), game(2, "Valheim", 1)]);
  expect(texts(p)).toContain("Minecraft");
  expect(buttons(p).map((b) => parseId(String(b.custom_id)))).toEqual([
    { kind: "menu", action: "add" },
    { kind: "menu", action: "remove" },
  ]);
  expect(texts(myGamesView([]))).toContain("You haven't picked any games yet.");
});

test("game names are escaped and cannot ping", () => {
  const p = myGamesView([game(1, "*bold* @everyone", 1)]);
  expect(texts(p)).not.toContain("@everyone");
  expect(texts(p)).toContain("\\*bold\\*");
  expect(p.allowedMentions).toEqual({ parse: [] });
});

test("people list: mentions, capped at 50 with a count, empty state", () => {
  const ids = Array.from({ length: 60 }, (_, i) => `1000000000000${String(10000 + i)}`);
  const p = peopleListView("Who plays X", ids, "Nobody has this game yet.");
  expect(texts(p)).toContain("<@100000000000010000>");
  expect(texts(p)).not.toContain("<@100000000000010050>");
  expect(texts(p)).toContain("…and 10 more");
  expect(texts(peopleListView("T", [], "Nobody has this game yet."))).toContain(
    "Nobody has this game yet.",
  );
  expect(Number(p.flags) & MessageFlags.Ephemeral).toBeTruthy();
});

test("game list view shows names or the empty text", () => {
  expect(texts(gameListView("Title", [game(1, "Minecraft", 1)], "none"))).toContain("Minecraft");
  expect(texts(gameListView("Title", [], "You have no games in common."))).toContain(
    "You have no games in common.",
  );
});

const manyCategories = Array.from({ length: 12 }, (_, i) => cat(i + 1, `C${String(i + 1)}`));
const manyGames = manyCategories.flatMap((c) =>
  Array.from({ length: 50 }, (_, i) => game(c.id * 100 + i, `G${String(i)}`, c.id)),
);

test("pick view pages: 24 chunks give 2+ pages, each within 40, every game reachable", () => {
  const count = pickGamePageCount(manyCategories, manyGames);
  expect(count).toBeGreaterThanOrEqual(2);
  const pages = Array.from({ length: count }, (_, i) =>
    pickGameView("who", manyCategories, manyGames, i),
  );
  for (const p of pages) expect(countComponents(p)).toBeLessThanOrEqual(40);
  const values = pages.flatMap(allSelects).flatMap((s) => s.options as { value: string }[]);
  expect(new Set(values.map((o) => o.value)).size).toBe(manyGames.length);
  const first = allSelects(pages[0]!)[0]!;
  expect(first.max_values).toBe(1);
  expect(parseId(String(first.custom_id))).toEqual({
    kind: "pick",
    purpose: "who",
    categoryId: 1,
    chunk: 0,
  });
  const ids0 = buttons(pages[0]!).map((b) => parseId(String(b.custom_id)));
  expect(ids0).toContainEqual({ kind: "pick-page", purpose: "who", page: 1 });
  expect(ids0).toContainEqual({ kind: "cancel" });
  const last = buttons(pages[count - 1]!).map((b) => parseId(String(b.custom_id)));
  expect(last).toContainEqual({ kind: "pick-page", purpose: "who", page: count - 2 });
});

test("pick view with one page has a cancel button and no pager", () => {
  const p = pickGameView("lfg", [chill], [game(1, "Minecraft", 1)], 0);
  expect(buttons(p).map((b) => parseId(String(b.custom_id)))).toEqual([{ kind: "cancel" }]);
});

test("remove view with 60 games: three dropdowns, all games, within 40", () => {
  const games = Array.from({ length: 60 }, (_, i) => game(i + 1, `G${String(i + 100)}`, 1));
  const p = removeGamesView(games, "Removed X.");
  expect(allSelects(p).map((s) => (s.options as unknown[]).length)).toEqual([25, 25, 10]);
  expect(countComponents(p)).toBeLessThanOrEqual(40);
});

test("panel does not claim picks are private", () => {
  expect(texts(panelView())).toContain("Your menu is only visible to you.");
  expect(texts(panelView())).not.toContain("picks are private");
});

test("changedOptionIds: only options whose tick differs from what was rendered", () => {
  const rendered = [
    { value: "1", default: true },
    { value: "2", default: true },
    { value: "3" },
    { value: "4" },
  ];
  // 1 untouched (owned), 2 unticked, 3 ticked, 4 untouched (unowned)
  expect(changedOptionIds(rendered, ["1", "3"])).toEqual([2, 3]);
  expect(changedOptionIds(rendered, ["1", "2"])).toEqual([]);
  expect(changedOptionIds(rendered, [])).toEqual([1, 2]);
});
