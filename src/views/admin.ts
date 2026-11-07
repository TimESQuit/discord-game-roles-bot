import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIComponentInContainer,
  type APIContainerComponent,
} from "discord.js";
import { COMPONENT_LIMIT, TEXT_LIMIT } from "../constants.ts";
import type { Category, Game, Suggestion } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import { CATEGORY_NAME_MAX } from "../domain/index.ts";
import type { SetupItem } from "../domain/index.ts";
import { encodeId, type CustomId } from "../domain/index.ts";
import { truncate } from "./limits.ts";
import { FIELD, categoryLabel, inputLabel, reviewCardView, textInput } from "./suggestions.ts";
import { text } from "../domain/index.ts";

const PRIVATE = (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number;
const NO_PINGS = { parse: [] } as const;
const TEXT_DISPLAY_MAX = 4000;

type Part = APIComponentInContainer;
type Row = APIActionRowComponent<APIButtonComponent>;

const display = (content: string): Part => ({
  type: ComponentType.TextDisplay,
  content: truncate(content, TEXT_DISPLAY_MAX),
});

const button = (
  id: CustomId,
  label: string,
  style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Danger = ButtonStyle.Secondary,
  disabled = false,
): APIButtonComponent => ({
  type: ComponentType.Button,
  style,
  label: truncate(label, TEXT_LIMIT),
  custom_id: encodeId(id),
  ...(disabled ? { disabled } : {}),
});

const row = (...buttons: APIButtonComponent[]): Row => ({
  type: ComponentType.ActionRow,
  components: buttons,
});

function privateView(parts: (Part | Row)[]): Payload {
  const inner: APIContainerComponent = {
    type: ComponentType.Container,
    components: parts as APIContainerComponent["components"],
  };
  return {
    flags: PRIVATE as MessageFlags.IsComponentsV2,
    components: [inner],
    allowedMentions: NO_PINGS,
  };
}

// container + the "and N more" line
const REVIEW_BUDGET = COMPONENT_LIMIT - 2;
// Discord counts all text displays together; leave room for the "and N more" line.
const REVIEW_TEXT_BUDGET = 4000 - 40;

/** Compact cards with the same buttons as #bot-admin, as many as fit in 40 components. */
export function reviewListView(
  pending: readonly Suggestion[],
  categoriesById: ReadonlyMap<number, Category>,
): Payload {
  if (pending.length === 0) return privateView([display("No suggestions waiting for review.")]);
  const parts: (Part | Row)[] = [];
  let used = 0;
  let chars = 0;
  let shown = 0;
  for (const s of pending) {
    const card = reviewCardView(s, categoriesById.get(s.categoryId)?.name ?? "Unknown");
    const inner = (card.components![0] as APIContainerComponent).components;
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
    parts.push(...(inner as (Part | Row)[]));
    used += cost;
    chars += length;
    shown += 1;
  }
  const more = pending.length - shown;
  if (more > 0) parts.push(display(`…and ${String(more)} more in #bot-admin`));
  return privateView(parts);
}

const ALIASES_MAX = 300;
const ALIASES_MODAL_MAX = 4000;

/** At most 25 categories; the game's own category is always among them. */
function modalCategories(categories: readonly Category[], current?: number): Category[] {
  const first = categories.slice(0, 25);
  if (current === undefined || first.some((c) => c.id === current)) return first;
  const own = categories.find((c) => c.id === current);
  return own ? [...first.slice(0, 24), own] : first;
}

export function gameModal(categories: readonly Category[], game?: Game): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(
      encodeId(game ? { kind: "game-edit-modal", gameId: game.id } : { kind: "game-add-modal" }),
    )
    .setTitle(game ? "Edit game" : "Add a game")
    .addLabelComponents(
      inputLabel("Game name", textInput(FIELD.name, TextInputStyle.Short, 100, true, game?.name)),
      categoryLabel(modalCategories(categories, game?.categoryId), game?.categoryId),
    );
  const aliases = game?.aliases.join(", ") ?? "";
  if (aliases.length > ALIASES_MODAL_MAX) {
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
  return privateView([
    display(`Remove ${text(game.name)}? ${members} will lose the role.`),
    row(
      button({ kind: "confirm-remove", gameId: game.id }, "Confirm", ButtonStyle.Danger),
      button({ kind: "cancel" }, "Cancel"),
    ),
  ]);
}

// container + header + note + the Add category row and its button
const CATEGORIES_SHOWN = Math.floor((COMPONENT_LIMIT - 5) / 5);

export function categoriesView(categories: readonly Category[]): Payload {
  const shown = categories.slice(0, CATEGORIES_SHOWN);
  const parts: (Part | Row)[] = [display("### Categories")];
  for (const [index, c] of shown.entries()) {
    const buttons: APIButtonComponent[] = [];
    if (index > 0)
      buttons.push(button({ kind: "category-move", categoryId: c.id, dir: "up" }, "Up"));
    if (index < categories.length - 1) {
      buttons.push(button({ kind: "category-move", categoryId: c.id, dir: "down" }, "Down"));
    }
    buttons.push(button({ kind: "category-rename", categoryId: c.id }, "Rename"));
    parts.push(display(`**${text(c.name)}**`), row(...buttons));
  }
  if (categories.length > shown.length) {
    parts.push(
      display(`Showing the first ${String(shown.length)}. Use /gameadmin category for the rest.`),
    );
  }
  parts.push(row(button({ kind: "category-add" }, "Add category", ButtonStyle.Primary)));
  return privateView(parts);
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
  return privateView([
    display(lines.join("\n")),
    row(
      button({ kind: "confirm-setup" }, "Confirm", ButtonStyle.Primary, blocked),
      button({ kind: "cancel" }, "Cancel"),
    ),
  ]);
}

export function setupReportView(result: {
  created: readonly SetupItem[];
  fine: readonly SetupItem[];
}): Payload {
  return privateView([
    display(
      [
        "### Setup finished",
        `Created: ${itemList(result.created)}`,
        `Already fine: ${itemList(result.fine)}`,
        "Next: set the template role's color, and add a healthchecks.io webhook in #bot-admin.",
      ].join("\n"),
    ),
  ]);
}
