import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIButtonComponentWithCustomId,
  type APIComponentInContainer,
  type APIContainerComponent,
  type APIStringSelectComponent,
  type APITextDisplayComponent,
} from "discord.js";
import {
  COMPONENT_LIMIT,
  MESSAGES,
  PEOPLE_SHOWN_MAX,
  SELECT_OPTION_LIMIT,
  TEXT_DISPLAY_LIMIT,
  TEXT_LIMIT,
} from "../constants.ts";
import type { Category, Game } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import {
  byName,
  encodeId,
  text,
  type PickPurpose,
  type AdminAction,
  type CustomId,
  type MenuAction,
} from "../domain/index.ts";
import { truncate } from "./limits.ts";

const V2 = [MessageFlags.IsComponentsV2] as const;
const PRIVATE = [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] as const;
const NO_PINGS = { parse: [] } as const;

type Row =
  | APIActionRowComponent<APIButtonComponent>
  | APIActionRowComponent<APIStringSelectComponent>;

const display = (content: string): APITextDisplayComponent => ({
  type: ComponentType.TextDisplay,
  content,
});
const separator = (): APIComponentInContainer => ({ type: ComponentType.Separator });

const button = (
  id: CustomId,
  label: string,
  style: APIButtonComponentWithCustomId["style"] = ButtonStyle.Secondary,
  disabled = false,
): APIButtonComponent => ({
  type: ComponentType.Button,
  style,
  label: truncate(label, TEXT_LIMIT),
  custom_id: encodeId(id),
  ...(disabled ? { disabled } : {}),
});
const buttonRow = (
  ...buttons: APIButtonComponent[]
): APIActionRowComponent<APIButtonComponent> => ({
  type: ComponentType.ActionRow,
  components: buttons,
});

const container = (...components: (APIComponentInContainer | Row)[]): APIContainerComponent => ({
  type: ComponentType.Container,
  components: components,
});

function payload(inner: APIContainerComponent, privateMessage: boolean): Payload {
  return {
    flags: privateMessage ? PRIVATE : V2,
    components: [inner],
    allowedMentions: NO_PINGS,
  };
}

/** A one-line private message in the new layout (e.g. "Cancelled."). */
export function noticeView(message: string): Payload {
  return payload(container(display(message)), true);
}

export function panelView(): Payload {
  return payload(
    container(
      display(
        "### Game roles\nPick the games you play to get their roles. Your menu is only visible to you.",
      ),
      buttonRow(button({ kind: "panel-open" }, "Open game roles", ButtonStyle.Primary)),
    ),
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
  const parts: (APIComponentInContainer | Row)[] = [
    display("### Game roles\nWhat would you like to do?"),
    buttonRow(
      m("add", "Add games", ButtonStyle.Primary),
      m("remove", "Remove games"),
      m("suggest", "Suggest a game"),
      m("mine", "My games"),
      m("who", "Who plays…?"),
    ),
    buttonRow(m("mysug", "My suggestions"), m("lfg", "Looking for group")),
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
  return payload(container(...parts), true);
}

function chunked<T>(items: readonly T[], size = SELECT_OPTION_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The games of one category in the order shown, in chunks of 25. Handlers recompute chunks with this. */
export function categoryChunks(games: readonly Game[], categoryId: number): Game[][] {
  return chunked(games.filter((g) => g.categoryId === categoryId).toSorted(byName));
}

/** A person's games in the order shown by the remove menu, in chunks of 25. */
export function ownedChunks(owned: readonly Game[]): Game[][] {
  return chunked(owned.toSorted(byName));
}

const options = (games: readonly Game[], ticked: ReadonlySet<string> | null) =>
  games.map((g) => ({
    label: truncate(g.name, TEXT_LIMIT),
    value: String(g.id),
    ...(ticked?.has(g.roleId) ? { default: true } : {}),
  }));

function selectRow(
  id: CustomId,
  placeholder: string,
  opts: ReturnType<typeof options>,
  multi: boolean,
): APIActionRowComponent<APIStringSelectComponent> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        custom_id: encodeId(id),
        placeholder: truncate(placeholder, TEXT_LIMIT),
        min_values: multi ? 0 : 1,
        max_values: multi ? opts.length : 1,
        options: opts,
      },
    ],
  };
}

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

// container + notice + header + pager row with its two buttons
const ADD_BODY_BUDGET = COMPONENT_LIMIT - 1 - 1 - 1 - 3;

function addPages(categories: readonly Category[], games: readonly Game[]): Unit[][] {
  let current: Unit[] = [];
  const pages: Unit[][] = [current];
  let used = 0;
  for (const category of categories) {
    const chunks = categoryChunks(games, category.id);
    const units: Unit[] =
      chunks.length === 0
        ? [{ category, index: 0, count: 1, games: [] }]
        : chunks.map((chunk, index) => ({ category, index, count: chunks.length, games: chunk }));
    for (const unit of units) {
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
  chunk: number,
): number {
  const index = addPages(categories, games).findIndex((page) =>
    page.some((u) => u.category.id === categoryId && u.index === chunk),
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
  const parts: (APIComponentInContainer | Row)[] = [];
  if (notice) parts.push(display(truncate(notice, TEXT_DISPLAY_LIMIT)));
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
      const label =
        unit.count > 1
          ? `${unit.category.name} (${String(unit.index + 1)}/${String(unit.count)})`
          : unit.category.name;
      parts.push(
        selectRow(
          { kind: "add-select", categoryId: unit.category.id, chunk: unit.index },
          label,
          options(unit.games, memberRoleIds),
          true,
        ),
      );
    }
    previous = unit;
  }
  if (pages.length > 1) {
    parts.push(
      buttonRow(
        ...pagerButtons((target) => ({ kind: "add-page", page: target }), current, pages.length),
      ),
    );
  }
  return payload(container(...parts), true);
}

export function removeGamesView(ownedGames: readonly Game[], notice?: string): Payload {
  const parts: (APIComponentInContainer | Row)[] = [];
  if (notice) parts.push(display(truncate(notice, TEXT_DISPLAY_LIMIT)));
  const chunks = ownedChunks(ownedGames);
  if (chunks.length === 0) {
    parts.push(display(MESSAGES.noGamesPicked));
  } else {
    parts.push(display("### Remove games\nTick the games you want to leave."));
    // container + notice + header leave room for 18 dropdowns of two components each
    const shown = chunks.slice(0, 18);
    for (const [index, chunk] of shown.entries()) {
      const label =
        chunks.length > 1
          ? `Your games (${String(index + 1)}/${String(chunks.length)})`
          : "Your games";
      parts.push(
        selectRow({ kind: "remove-select", chunk: index }, label, options(chunk, null), true),
      );
    }
  }
  if (chunks.length > 18) {
    parts.push(display("Only the first 450 of your games are listed here."));
  }
  return payload(container(...parts), true);
}

// container + header + the row of Previous, Next and Cancel buttons (4)
const PICK_PER_PAGE = Math.floor((COMPONENT_LIMIT - 1 - 1 - 4) / 2);

type PickUnit = { category: Category; index: number; count: number; games: Game[] };

function pickUnits(categories: readonly Category[], games: readonly Game[]): PickUnit[] {
  return categories.flatMap((category) => {
    const chunks = categoryChunks(games, category.id);
    return chunks.map((chunk, index) => ({ category, index, count: chunks.length, games: chunk }));
  });
}

export function pickGamePageCount(categories: readonly Category[], games: readonly Game[]): number {
  return Math.max(1, Math.ceil(pickUnits(categories, games).length / PICK_PER_PAGE));
}

/** Single-choice game pickers, one per category chunk, paged to stay within 40 components. */
export function pickGameView(
  purpose: PickPurpose,
  categories: readonly Category[],
  games: readonly Game[],
  page = 0,
): Payload {
  const units = pickUnits(categories, games);
  const total = pickGamePageCount(categories, games);
  const current = Math.min(Math.max(0, page), total - 1);
  const rows = units.slice(current * PICK_PER_PAGE, (current + 1) * PICK_PER_PAGE).map((u) => {
    const label =
      u.count > 1
        ? `${u.category.name} (${String(u.index + 1)}/${String(u.count)})`
        : u.category.name;
    return selectRow(
      { kind: "pick", purpose, categoryId: u.category.id, chunk: u.index },
      label,
      options(u.games, null),
      false,
    );
  });
  const title = units.length === 0 ? "There are no games yet." : "### Pick a game";
  const header = total > 1 ? `${title}\n(Page ${String(current + 1)} of ${String(total)})` : title;
  const nav =
    total > 1 ? pagerButtons((p) => ({ kind: "pick-page", purpose, page: p }), current, total) : [];
  return payload(
    container(display(header), ...rows, buttonRow(...nav, button({ kind: "cancel" }, "Cancel"))),
    true,
  );
}

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
  const parts: (APIComponentInContainer | Row)[] = [];
  if (notice) parts.push(display(truncate(notice, TEXT_DISPLAY_LIMIT)));
  parts.push(
    display(
      `### My games\n${listBody(
        games.toSorted(byName).map((g) => `- ${text(g.name)}`),
        MESSAGES.noGamesPicked,
      )}`,
    ),
    buttonRow(
      button({ kind: "menu", action: "add" }, "Add games", ButtonStyle.Primary),
      button({ kind: "menu", action: "remove" }, "Remove games"),
    ),
  );
  return payload(container(...parts), true);
}

/** `title` is trusted text; callers escape any name they put in it with `text()`. */
export function gameListView(title: string, games: readonly Game[], empty: string): Payload {
  const body = listBody(
    games.toSorted(byName).map((g) => `- ${text(g.name)}`),
    empty,
  );
  return payload(container(display(`### ${title}\n${body}`)), true);
}

/** A list of people as mentions (they do not ping), capped at 50. */
export function peopleListView(title: string, userIds: readonly string[], empty: string): Payload {
  const shown = userIds.slice(0, PEOPLE_SHOWN_MAX).map((id) => `<@${id}>`);
  const more = userIds.length - shown.length;
  const body =
    userIds.length === 0
      ? empty
      : [shown.join("\n"), ...(more > 0 ? [`…and ${String(more)} more`] : [])].join("\n");
  return payload(container(display(`### ${title}\n${body}`)), true);
}
