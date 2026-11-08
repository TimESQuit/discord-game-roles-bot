import {
  ButtonStyle,
  ComponentType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  ALIASES_MAX,
  BUTTONS_PER_ROW,
  GAME_NAME_MAX,
  NOTE_MAX,
  REASON_MAX,
  SELECT_OPTION_LIMIT,
  TEXT_DISPLAY_LIMIT,
  TEXT_LIMIT,
} from "../constants.ts";
import { encodeId, text } from "../domain/index.ts";
import { truncate } from "./limits.ts";

import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIComponentInContainer,
  APIContainerComponent,
} from "discord.js";
import type { Category, Game, Suggestion } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { CustomId } from "../domain/index.ts";

const V2 = [MessageFlags.IsComponentsV2] as const;
const PRIVATE = [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] as const;
const NO_PINGS = { parse: [] } as const;
const DECIDED_SHOWN = 10;
const PENDING_SHOWN = 10;

/** Field IDs inside the modals (read back with `interaction.fields`). */
export const FIELD = {
  name: "name",
  category: "category",
  note: "note",
  aliases: "aliases",
  reason: "reason",
} as const;

type Row = APIActionRowComponent<APIButtonComponent>;

const display = (content: string): APIComponentInContainer => ({
  type: ComponentType.TextDisplay,
  content: truncate(content, TEXT_DISPLAY_LIMIT),
});

const button = (
  id: CustomId,
  label: string,
  style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger,
): APIButtonComponent => ({
  type: ComponentType.Button,
  style,
  label: truncate(label, TEXT_LIMIT),
  custom_id: encodeId(id),
});

const row = (...buttons: APIButtonComponent[]): Row => ({
  type: ComponentType.ActionRow,
  components: buttons,
});

function payload(parts: (APIComponentInContainer | Row)[], privateMessage: boolean): Payload {
  const inner: APIContainerComponent = {
    type: ComponentType.Container,
    components: parts,
  };
  return {
    flags: privateMessage ? PRIVATE : V2,
    components: [inner],
    allowedMentions: NO_PINGS,
  };
}

function statusLine(s: Suggestion): string {
  switch (s.status) {
    case "pending":
      return "Pending review";
    case "approved":
      return `Approved by <@${s.reviewerId}>`;
    case "rejected":
      return `Rejected by <@${s.reviewerId}>${s.rejectionReason ? `: ${text(s.rejectionReason)}` : ""}`;
    case "withdrawn":
      return `Withdrawn by <@${s.suggesterId}>`;
    default: {
      const unhandled: never = s.status;
      throw new Error(`Unhandled suggestion status: ${String(unhandled)}`);
    }
  }
}

/** The parts of the review card, so the review list can reuse them without unwrapping a payload. */
export function reviewCardParts(
  s: Suggestion,
  categoryName: string,
  aliases?: string,
): (APIComponentInContainer | Row)[] {
  const shownAliases = aliases ?? s.aliases;
  const lines = [
    `**Suggestion #${s.id}:** **${text(s.name)}** from <@${s.suggesterId}>`,
    `Category: ${text(categoryName)}`,
  ];
  if (shownAliases) lines.push(`Aliases: ${text(shownAliases)}`);
  if (s.note) lines.push(`Note: ${text(s.note)}`);
  lines.push(statusLine(s));
  const parts: (APIComponentInContainer | Row)[] = [display(lines.join("\n"))];
  if (s.status === "pending") {
    parts.push(
      row(
        button({ kind: "review-approve", suggestionId: s.id }, "Approve", ButtonStyle.Success),
        button({ kind: "review-edit", suggestionId: s.id }, "Edit", ButtonStyle.Secondary),
        button({ kind: "review-reject", suggestionId: s.id }, "Reject", ButtonStyle.Danger),
      ),
    );
  }
  return parts;
}

/** The #bot-admin card. Independent of the channel, so the review list can reuse it. */
export function reviewCardView(s: Suggestion, categoryName: string, aliases?: string): Payload {
  return payload(reviewCardParts(s, categoryName, aliases), false);
}

/** Posted in #game-news. The role mention shows but does not ping. */
export function announcementView(game: Game): Payload {
  return payload([display(`New game: **${text(game.name)}** — <@&${game.roleId}>`)], false);
}

export function duplicatePromptView(matches: {
  games: readonly Game[];
  pending: readonly { id: number; name: string }[];
}): Payload {
  const games = matches.games.slice(0, BUTTONS_PER_ROW);
  const lines = ["### Did you mean…?"];
  if (games.length > 0) lines.push("These games already exist:");
  for (const g of games) lines.push(`- ${text(g.name)}`);
  if (matches.pending.length > 0) {
    lines.push("Already suggested and waiting for review:");
    for (const p of matches.pending) lines.push(`- ${text(p.name)}`);
  }
  const parts: (APIComponentInContainer | Row)[] = [display(lines.join("\n"))];
  if (games.length > 0) {
    parts.push(
      row(
        ...games.map((g) =>
          button({ kind: "dup-join", gameId: g.id }, `Join ${g.name}`, ButtonStyle.Primary),
        ),
      ),
    );
  }
  parts.push(
    row(
      button({ kind: "dup-submit" }, "Submit anyway", ButtonStyle.Secondary),
      button({ kind: "cancel" }, "Cancel", ButtonStyle.Secondary),
    ),
  );
  return payload(parts, true);
}

const newestFirst = (a: Suggestion, b: Suggestion): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

function decidedLine(s: Suggestion, categories: ReadonlyMap<number, Category>): string {
  const category = categories.get(s.categoryId)?.name;
  const where = category === undefined ? "" : ` (${text(category)})`;
  const status =
    s.status === "rejected"
      ? `Rejected${s.rejectionReason ? `: ${text(s.rejectionReason)}` : ""}`
      : s.status === "approved"
        ? "Approved"
        : "Withdrawn";
  return `- **${text(s.name)}**${where}: ${status}`;
}

export function mySuggestionsView(
  suggestions: readonly Suggestion[],
  categoriesById: ReadonlyMap<number, Category>,
): Payload {
  const sorted = suggestions.toSorted(newestFirst);
  const pending = sorted.filter((s) => s.status === "pending").slice(0, PENDING_SHOWN);
  const decided = sorted.filter((s) => s.status !== "pending").slice(0, DECIDED_SHOWN);
  if (pending.length === 0 && decided.length === 0) {
    return payload([display("You haven't suggested any games yet.")], true);
  }
  const parts: (APIComponentInContainer | Row)[] = [display("### My suggestions")];
  if (pending.length > 0) {
    parts.push(display("**Waiting for review**"));
    for (const s of pending) {
      const category = categoriesById.get(s.categoryId)?.name;
      parts.push(
        display(`**${text(s.name)}**${category === undefined ? "" : ` (${text(category)})`}`),
        row(button({ kind: "withdraw", suggestionId: s.id }, "Withdraw", ButtonStyle.Danger)),
      );
    }
  }
  if (decided.length > 0) {
    parts.push(
      display(`**Decided**\n${decided.map((s) => decidedLine(s, categoriesById)).join("\n")}`),
    );
  }
  return payload(parts, true);
}

export const textInput = (
  id: string,
  style: TextInputStyle,
  max: number,
  required: boolean,
  value?: string,
): TextInputBuilder => {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(style)
    .setMaxLength(max)
    .setRequired(required);
  if (value) input.setValue(truncate(value, max));
  return input;
};

export function categoryLabel(categories: readonly Category[], currentId?: number): LabelBuilder {
  return new LabelBuilder().setLabel("Category").setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId(FIELD.category)
      .setRequired(true)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        categories.map((c) => ({
          label: truncate(c.name, TEXT_LIMIT),
          value: String(c.id),
          default: c.id === currentId,
        })),
      ),
  );
}

export const inputLabel = (label: string, input: TextInputBuilder): LabelBuilder =>
  new LabelBuilder().setLabel(label).setTextInputComponent(input);

export function suggestModal(categories: readonly Category[]): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(encodeId({ kind: "suggest-modal" }))
    .setTitle("Suggest a game")
    .addLabelComponents(
      inputLabel("Game name", textInput(FIELD.name, TextInputStyle.Short, GAME_NAME_MAX, true)),
      categoryLabel(categories.slice(0, SELECT_OPTION_LIMIT)),
      inputLabel(
        "Note for the admins (optional)",
        textInput(FIELD.note, TextInputStyle.Paragraph, NOTE_MAX, false),
      ),
    );
}

export function reviewEditModal(s: Suggestion, categories: readonly Category[]): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(encodeId({ kind: "review-edit-modal", suggestionId: s.id }))
    .setTitle("Edit suggestion")
    .addLabelComponents(
      inputLabel(
        "Game name",
        textInput(FIELD.name, TextInputStyle.Short, GAME_NAME_MAX, true, s.name),
      ),
      categoryLabel(categories.slice(0, SELECT_OPTION_LIMIT), s.categoryId),
      inputLabel(
        "Aliases (comma separated)",
        textInput(FIELD.aliases, TextInputStyle.Short, ALIASES_MAX, false, s.aliases ?? undefined),
      ),
    );
}

export function rejectModal(s: Suggestion): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(encodeId({ kind: "review-reject-modal", suggestionId: s.id }))
    .setTitle("Reject suggestion")
    .addLabelComponents(
      inputLabel("Reason", textInput(FIELD.reason, TextInputStyle.Paragraph, REASON_MAX, true)),
    );
}
