import { ButtonStyle } from "discord.js";

import {
  COMPONENT_LIMIT,
  MESSAGES,
  SELECT_OPTION_LIMIT,
  TEXT_DISPLAY_LIMIT,
  TEXT_LIMIT,
} from "../constants.ts";
import { byName, chunk, text } from "../domain/index.ts";
import {
  button,
  buttonRow,
  closeButton,
  display,
  payload,
  selectRow,
  separator,
  shownPeople,
} from "./components.ts";
import { truncate } from "./limits.ts";

import type { APIButtonComponent } from "discord.js";
import type { Category, Game } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { PickPurpose, AdminAction, CustomId, MenuAction } from "../domain/index.ts";
import type { Part, PrivateView } from "./components.ts";

/** A one-line private message in the new layout that stays up, such as an error. */
export function messageView(message: string): Payload {
  return payload([display(message)], true);
}

/** A one-line private result (e.g. "Removed X.") that closes itself soon after it is shown. */
export function noticeView(message: string): PrivateView {
  return { ...messageView(message), notice: true };
}

export function panelView(): Payload {
  return payload(
    [
      display(
        "### Game roles\nPick the games you play to get their roles. Your menu is only visible to you.",
      ),
      buttonRow(button({ kind: "panel-open" }, "Open game roles", ButtonStyle.Primary)),
    ],
    false,
  );
}

const m = (
  action: MenuAction,
  label: string,
  style: ButtonStyle.Primary | ButtonStyle.Secondary = ButtonStyle.Secondary,
) => button({ kind: "menu", action }, label, style);
const a = (action: AdminAction, label: string) => button({ kind: "admin", action }, label);

export function menuView({ isAdmin }: { isAdmin: boolean }): Payload {
  const parts: Part[] = [
    display("### Game roles\nWhat would you like to do?"),
    buttonRow(
      m("add", "Add games", ButtonStyle.Primary),
      m("remove", "Remove games"),
      m("suggest", "Suggest a game"),
      m("mine", "My games"),
      m("who", "Who plays…?"),
    ),
    buttonRow(m("mysug", "My suggestions"), m("lfg", "Looking for group"), closeButton()),
  ];
  if (isAdmin) {
    parts.push(
      separator(),
      display("**Admin**"),
      buttonRow(
        a("review", "Review suggestions"),
        a("add", "Add a game"),
        a("edit", "Edit a game"),
        a("remove", "Remove a game"),
        a("categories", "Manage categories"),
      ),
      buttonRow(
        a("reapply", "Re-apply template"),
        a("refresh", "Refresh panel"),
        a("backup", "Run backup now"),
        a("setup", "Run setup"),
      ),
    );
  }
  return payload(parts, true);
}

/**
 * The remove menu fits this many dropdowns: each takes two components (row + select), and the
 * container, notice, header, cut-off note and the Close row with its button take the other six
 * of the per-message component limit.
 */
const REMOVE_DROPDOWNS = Math.floor((COMPONENT_LIMIT - 6) / 2);

/** The games of one category in the order shown, in chunks of up to the select-option limit. Handlers recompute chunks with this. */
export function categoryChunks(games: readonly Game[], categoryId: number): Game[][] {
  return chunk(games.filter((g) => g.categoryId === categoryId).toSorted(byName));
}

/** A person's games in the order shown by the remove menu, in chunks of up to the select-option limit. */
export function ownedChunks(owned: readonly Game[]): Game[][] {
  return chunk(owned.toSorted(byName));
}

const options = (games: readonly Game[], ticked: ReadonlySet<string> | null) =>
  games.map((g) => ({
    label: truncate(g.name, TEXT_LIMIT),
    value: String(g.id),
    ...(ticked?.has(g.roleId) ? { default: true } : {}),
  }));

/** Previous and Next buttons shared by the add and pick views. */
function pagerButtons(
  idFor: (page: number) => CustomId,
  current: number,
  total: number,
): APIButtonComponent[] {
  return [
    button(idFor(Math.max(0, current - 1)), "‹ Previous", ButtonStyle.Secondary, current === 0),
    button(
      idFor(Math.min(total - 1, current + 1)),
      "Next ›",
      ButtonStyle.Secondary,
      current === total - 1,
    ),
  ];
}

/** The options whose tick differs from what was rendered: the only ones a submit may change. */
export function changedOptionIds(
  rendered: readonly { value: string; default?: boolean | null }[],
  values: readonly string[],
): number[] {
  const selected = new Set(values);
  return rendered
    .filter((o) => (o.default === true) !== selected.has(o.value))
    .map((o) => Number(o.value))
    .filter((id) => Number.isInteger(id));
}

type Unit = { category: Category; index: number; count: number; games: Game[] };

/** "Name (i/n)" when a category's games span several dropdowns, plain "Name" otherwise. */
const chunkLabel = (name: string, index: number, count: number): string =>
  count > 1 ? `${name} (${String(index + 1)}/${String(count)})` : name;

/** One unit per dropdown. A category without games keeps an empty placeholder unit when `keepEmpty`. */
function unitsOf(
  categories: readonly Category[],
  games: readonly Game[],
  keepEmpty: boolean,
): Unit[] {
  return categories.flatMap((category) => {
    const chunks = categoryChunks(games, category.id);
    if (chunks.length === 0) return keepEmpty ? [{ category, index: 0, count: 1, games: [] }] : [];
    return chunks.map((group, index) => ({ category, index, count: chunks.length, games: group }));
  });
}

// container + notice + header + the last row with Previous, Next and Close
const ADD_BODY_BUDGET = COMPONENT_LIMIT - 1 - 1 - 1 - 4;

function addPages(categories: readonly Category[], games: readonly Game[]): Unit[][] {
  let current: Unit[] = [];
  const pages: Unit[][] = [current];
  let used = 0;
  for (const unit of unitsOf(categories, games, true)) {
    const heading = unit.index === 0 || current.length === 0 ? 1 : 0;
    const cost = unit.games.length === 0 ? 1 : heading + 2;
    if (used + cost > ADD_BODY_BUDGET && current.length > 0) {
      current = [unit];
      pages.push(current);
      used = unit.games.length === 0 ? 1 : 3;
    } else {
      current.push(unit);
      used += cost;
    }
  }
  return pages;
}

export function addGamesPageCount(categories: readonly Category[], games: readonly Game[]): number {
  return addPages(categories, games).length;
}

/** The page that holds one dropdown, so a handler can re-render where the person was. */
export function addGamesPageOf(
  categories: readonly Category[],
  games: readonly Game[],
  categoryId: number,
  chunkIndex: number,
): number {
  const index = addPages(categories, games).findIndex((page) =>
    page.some((u) => u.category.id === categoryId && u.index === chunkIndex),
  );
  return Math.max(0, index);
}

export function addGamesView(
  categories: readonly Category[],
  games: readonly Game[],
  memberRoleIds: ReadonlySet<string>,
  page: number,
  notice?: string,
): Payload {
  const pages = addPages(categories, games);
  const current = Math.min(Math.max(0, page), pages.length - 1);
  const parts: Part[] = [];
  if (notice) parts.push(display(notice));
  parts.push(
    display(
      `### Add games\nTick the games you play and untick the ones you don't.${pages.length > 1 ? ` (Page ${String(current + 1)} of ${String(pages.length)})` : ""}`,
    ),
  );
  let previous: Unit | undefined;
  for (const unit of pages[current] ?? []) {
    const name = text(unit.category.name);
    if (unit.games.length === 0) {
      parts.push(display(`### ${name}\n_No games yet._`));
    } else {
      if (unit.index === 0) parts.push(display(`### ${name}`));
      else if (previous?.category.id !== unit.category.id) {
        parts.push(display(`### ${name} (continued)`));
      }
      parts.push(
        selectRow(
          { kind: "add-select", categoryId: unit.category.id, chunk: unit.index },
          chunkLabel(unit.category.name, unit.index, unit.count),
          options(unit.games, memberRoleIds),
          true,
        ),
      );
    }
    previous = unit;
  }
  const pager =
    pages.length > 1
      ? pagerButtons((target) => ({ kind: "add-page", page: target }), current, pages.length)
      : [];
  parts.push(buttonRow(...pager, closeButton()));
  return payload(parts, true);
}

export function removeGamesView(ownedGames: readonly Game[], notice?: string): Payload {
  const parts: Part[] = [];
  if (notice) parts.push(display(notice));
  const chunks = ownedChunks(ownedGames);
  if (chunks.length === 0) {
    parts.push(display(MESSAGES.noGamesPicked));
  } else {
    parts.push(display("### Remove games\nTick the games you want to leave."));
    const shown = chunks.slice(0, REMOVE_DROPDOWNS);
    for (const [index, group] of shown.entries()) {
      parts.push(
        selectRow(
          { kind: "remove-select", chunk: index },
          chunkLabel("Your games", index, chunks.length),
          options(group, null),
          true,
        ),
      );
    }
  }
  if (chunks.length > REMOVE_DROPDOWNS) {
    const listed = REMOVE_DROPDOWNS * SELECT_OPTION_LIMIT;
    parts.push(display(`Only the first ${String(listed)} of your games are listed here.`));
  }
  parts.push(buttonRow(closeButton()));
  return payload(parts, true);
}

// container + header + the row of Previous, Next and Cancel buttons (4)
const PICK_PER_PAGE = Math.floor((COMPONENT_LIMIT - 1 - 1 - 4) / 2);

export function pickGamePageCount(categories: readonly Category[], games: readonly Game[]): number {
  return Math.max(1, Math.ceil(unitsOf(categories, games, false).length / PICK_PER_PAGE));
}

/** Single-choice game pickers, one per category chunk, paged to stay within 40 components. */
export function pickGameView(
  purpose: PickPurpose,
  categories: readonly Category[],
  games: readonly Game[],
  page = 0,
): Payload {
  const units = unitsOf(categories, games, false);
  const total = pickGamePageCount(categories, games);
  const current = Math.min(Math.max(0, page), total - 1);
  const rows = units.slice(current * PICK_PER_PAGE, (current + 1) * PICK_PER_PAGE).map((u) => {
    return selectRow(
      { kind: "pick", purpose, categoryId: u.category.id, chunk: u.index },
      chunkLabel(u.category.name, u.index, u.count),
      options(u.games, null),
      false,
    );
  });
  const title = units.length === 0 ? "There are no games yet." : "### Pick a game";
  const header = total > 1 ? `${title}\n(Page ${String(current + 1)} of ${String(total)})` : title;
  const nav =
    total > 1 ? pagerButtons((p) => ({ kind: "pick-page", purpose, page: p }), current, total) : [];
  return payload([display(header), ...rows, buttonRow(...nav, closeButton("Cancel"))], true);
}

/** One bulleted line per game, A→Z, cut short to fit one text display. */
const gamesBody = (games: readonly Game[], empty: string): string =>
  listBody(
    games.toSorted(byName).map((g) => `- ${text(g.name)}`),
    empty,
  );

function listBody(lines: readonly string[], empty: string): string {
  if (lines.length === 0) return empty;
  const out: string[] = [];
  let length = 0;
  for (const [index, line] of lines.entries()) {
    if (length + line.length + 1 > TEXT_DISPLAY_LIMIT - 300) {
      out.push(`…and ${String(lines.length - index)} more`);
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join("\n");
}

export function myGamesView(games: readonly Game[], notice?: string): Payload {
  const parts: Part[] = [];
  if (notice) parts.push(display(notice));
  parts.push(
    display(`### My games\n${gamesBody(games, MESSAGES.noGamesPicked)}`),
    buttonRow(
      button({ kind: "menu", action: "add" }, "Add games", ButtonStyle.Primary),
      button({ kind: "menu", action: "remove" }, "Remove games"),
      closeButton(),
    ),
  );
  return payload(parts, true);
}

/** `title` is trusted text; callers escape any name they put in it with `text()`. */
export function gameListView(title: string, games: readonly Game[], empty: string): Payload {
  return payload(
    [display(`### ${title}\n${gamesBody(games, empty)}`), buttonRow(closeButton())],
    true,
  );
}

/** A list of people as mentions (they do not ping), capped at 50. */
export function peopleListView(title: string, userIds: readonly string[], empty: string): Payload {
  const { mentions, more } = shownPeople(userIds);
  const body =
    userIds.length === 0
      ? empty
      : [mentions.join("\n"), ...(more === null ? [] : [more])].join("\n");
  return payload([display(`### ${title}\n${body}`), buttonRow(closeButton())], true);
}
