import {
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputStyle,
} from "discord.js";

import {
  ALIASES_MAX,
  CATEGORY_NAME_MAX,
  COMPONENT_LIMIT,
  GAME_NAME_MAX,
  SELECT_OPTION_LIMIT,
  TEXT_DISPLAY_LIMIT,
  TEXT_INPUT_LIMIT,
} from "../constants.ts";
import { encodeId, text } from "../domain/index.ts";
import { button, buttonRow, display, payload } from "./components.ts";
import { FIELD, categoryLabel, inputLabel, textInput } from "./modals.ts";
import { reviewCardParts } from "./suggestions.ts";

import type { APIButtonComponent } from "discord.js";
import type { Category, Game, Suggestion } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { SetupItem } from "../domain/index.ts";
import type { Part } from "./components.ts";

// container + the "and N more" line
const REVIEW_BUDGET = COMPONENT_LIMIT - 2;
// Discord counts all text displays together; leave room for the "and N more" line.
const REVIEW_TEXT_BUDGET = TEXT_DISPLAY_LIMIT - 40;

/** Compact cards with the same buttons as #bot-admin, as many as fit in 40 components. */
export function reviewListView(
  pending: readonly Suggestion[],
  categoriesById: ReadonlyMap<number, Category>,
): Payload {
  if (pending.length === 0) return payload([display("No suggestions waiting for review.")], true);
  const parts: Part[] = [];
  let used = 0;
  let chars = 0;
  let shown = 0;
  for (const s of pending) {
    const inner = reviewCardParts(s, categoriesById.get(s.categoryId)?.name);
    // each nested component counts, rows include their buttons
    const cost = inner.reduce(
      (sum, c) => sum + 1 + ("components" in c ? c.components.length : 0),
      0,
    );
    const length = inner.reduce(
      (sum, c) => sum + (c.type === ComponentType.TextDisplay ? c.content.length : 0),
      0,
    );
    if (used + cost > REVIEW_BUDGET || chars + length > REVIEW_TEXT_BUDGET) break;
    parts.push(...inner);
    used += cost;
    chars += length;
    shown += 1;
  }
  const more = pending.length - shown;
  if (more > 0) parts.push(display(`…and ${String(more)} more in #bot-admin`));
  return payload(parts, true);
}

/** At most 25 categories; the game's own category is always among them. */
function modalCategories(categories: readonly Category[], current?: number): Category[] {
  const first = categories.slice(0, SELECT_OPTION_LIMIT);
  if (current === undefined || first.some((c) => c.id === current)) return first;
  const own = categories.find((c) => c.id === current);
  return own ? [...first.slice(0, SELECT_OPTION_LIMIT - 1), own] : first;
}

export function gameModal(categories: readonly Category[], game?: Game): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(
      encodeId(game ? { kind: "game-edit-modal", gameId: game.id } : { kind: "game-add-modal" }),
    )
    .setTitle(game ? "Edit game" : "Add a game")
    .addLabelComponents(
      inputLabel(
        "Game name",
        textInput(FIELD.name, TextInputStyle.Short, GAME_NAME_MAX, true, game?.name),
      ),
      categoryLabel(modalCategories(categories, game?.categoryId), game?.categoryId),
    );
  const aliases = game?.aliases.join(", ") ?? "";
  if (aliases.length > TEXT_INPUT_LIMIT) {
    modal.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Edit aliases with /gameadmin edit"),
    );
  } else {
    // The prefill is never cut: the field grows to fit what it holds.
    const max = Math.max(ALIASES_MAX, aliases.length);
    modal.addLabelComponents(
      inputLabel(
        "Aliases (comma separated, optional)",
        textInput(FIELD.aliases, TextInputStyle.Short, max, false, aliases),
      ),
    );
  }
  return modal;
}

export function categoryModal(category?: Category): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(
      encodeId(
        category
          ? { kind: "category-rename-modal", categoryId: category.id }
          : { kind: "category-add-modal" },
      ),
    )
    .setTitle(category ? "Rename category" : "Add a category")
    .addLabelComponents(
      inputLabel(
        "Category name",
        textInput(FIELD.name, TextInputStyle.Short, CATEGORY_NAME_MAX, true, category?.name),
      ),
    );
}

export function confirmRemoveView(game: Game, memberCount: number): Payload {
  const members = memberCount === 1 ? "1 member" : `${String(memberCount)} members`;
  return payload(
    [
      display(`Remove ${text(game.name)}? ${members} will lose the role.`),
      buttonRow(
        button({ kind: "confirm-remove", gameId: game.id }, "Confirm", ButtonStyle.Danger),
        button({ kind: "cancel" }, "Cancel"),
      ),
    ],
    true,
  );
}

// container + header + note + the Add category row and its button
const CATEGORIES_SHOWN = Math.floor((COMPONENT_LIMIT - 5) / 5);

export function categoriesView(categories: readonly Category[]): Payload {
  const shown = categories.slice(0, CATEGORIES_SHOWN);
  const parts: Part[] = [display("### Categories")];
  for (const [index, c] of shown.entries()) {
    const buttons: APIButtonComponent[] = [];
    if (index > 0)
      buttons.push(button({ kind: "category-move", categoryId: c.id, dir: "up" }, "Up"));
    if (index < categories.length - 1) {
      buttons.push(button({ kind: "category-move", categoryId: c.id, dir: "down" }, "Down"));
    }
    buttons.push(button({ kind: "category-rename", categoryId: c.id }, "Rename"));
    parts.push(display(`**${text(c.name)}**`), buttonRow(...buttons));
  }
  if (categories.length > shown.length) {
    parts.push(
      display(`Showing the first ${String(shown.length)}. Use /gameadmin category for the rest.`),
    );
  }
  parts.push(buttonRow(button({ kind: "category-add" }, "Add category", ButtonStyle.Primary)));
  return payload(parts, true);
}

const ITEM_LABELS: Record<SetupItem, string> = {
  templateRole: "template role",
  panelChannel: "panel channel",
  newsChannel: "#game-news",
  adminCategory: "Bot admin category",
  adminChannel: "#bot-admin",
  logChannel: "#bot-log",
  backupsChannel: "#bot-backups",
  categories: "starting categories",
  panelMessage: "panel message",
};

const itemList = (items: readonly SetupItem[]): string =>
  items.length > 0 ? items.map((i) => ITEM_LABELS[i]).join(", ") : "nothing";

export function setupPreviewView(
  problems: readonly string[],
  plan: { create: readonly SetupItem[]; fine: readonly SetupItem[] },
): Payload {
  const lines: string[] = ["### Setup"];
  if (problems.length > 0) {
    lines.push("**Fix these first:**", ...problems.map((p) => `- ${text(p)}`));
  }
  lines.push(`Will create: ${itemList(plan.create)}`, `Already fine: ${itemList(plan.fine)}`);
  const blocked = problems.length > 0 || plan.create.length === 0;
  return payload(
    [
      display(lines.join("\n")),
      buttonRow(
        button({ kind: "confirm-setup" }, "Confirm", ButtonStyle.Primary, blocked),
        button({ kind: "cancel" }, "Cancel"),
      ),
    ],
    true,
  );
}

export function setupReportView(result: {
  created: readonly SetupItem[];
  fine: readonly SetupItem[];
}): Payload {
  return payload(
    [
      display(
        [
          "### Setup finished",
          `Created: ${itemList(result.created)}`,
          `Already fine: ${itemList(result.fine)}`,
          "Next: set the template role's color.",
        ].join("\n"),
      ),
    ],
    true,
  );
}
