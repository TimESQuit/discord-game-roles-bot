import { ButtonStyle, ModalBuilder, TextInputStyle } from "discord.js";

import {
  ALIASES_MAX,
  BUTTONS_PER_ROW,
  GAME_NAME_MAX,
  NOTE_MAX,
  REASON_MAX,
  SELECT_OPTION_LIMIT,
} from "../constants.ts";
import { encodeId, text } from "../domain/index.ts";
import { button, buttonRow, closeButton, display, payload } from "./components.ts";
import { FIELD, categoryLabel, inputLabel, textInput } from "./modals.ts";

import type { Category, Game, Suggestion } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { Part } from "./components.ts";

const DECIDED_SHOWN = 10;
const PENDING_SHOWN = 10;

const rejection = (s: Suggestion): string =>
  s.rejectionReason ? `: ${text(s.rejectionReason)}` : "";

const categorySuffix = (categories: ReadonlyMap<number, Category>, categoryId: number): string => {
  const name = categories.get(categoryId)?.name;
  return name === undefined ? "" : ` (${text(name)})`;
};

function statusLine(s: Suggestion): string {
  switch (s.status) {
    case "pending":
      return "Pending review";
    case "approved":
      return `Approved by <@${s.reviewerId}>`;
    case "rejected":
      return `Rejected by <@${s.reviewerId}>${rejection(s)}`;
    case "withdrawn":
      return `Withdrawn by <@${s.suggesterId}>`;
    default: {
      const unhandled: never = s.status;
      throw new Error(`Unhandled suggestion status: ${String(unhandled)}`);
    }
  }
}

/**
 * The parts of the review card, so the review list can reuse them without unwrapping a payload.
 * `categoryName` is undefined when the category is gone.
 */
export function reviewCardParts(s: Suggestion, categoryName: string | undefined): Part[] {
  const lines = [
    `**Suggestion #${s.id}:** **${text(s.name)}** from <@${s.suggesterId}>`,
    `Category: ${text(categoryName ?? "Unknown")}`,
  ];
  if (s.aliases) lines.push(`Aliases: ${text(s.aliases)}`);
  if (s.note) lines.push(`Note: ${text(s.note)}`);
  lines.push(statusLine(s));
  const parts: Part[] = [display(lines.join("\n"))];
  if (s.status === "pending") {
    parts.push(
      buttonRow(
        button({ kind: "review-approve", suggestionId: s.id }, "Approve", ButtonStyle.Success),
        button({ kind: "review-edit", suggestionId: s.id }, "Edit", ButtonStyle.Secondary),
        button({ kind: "review-reject", suggestionId: s.id }, "Reject", ButtonStyle.Danger),
      ),
    );
  }
  return parts;
}

/** The #game-roles-admin card. Independent of the channel, so the review list can reuse it. */
export function reviewCardView(s: Suggestion, categoryName: string | undefined): Payload {
  return payload(reviewCardParts(s, categoryName), false);
}

/** Posted in #game-roles. The role mention shows but does not ping. */
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
  const parts: Part[] = [display(lines.join("\n"))];
  if (games.length > 0) {
    parts.push(
      buttonRow(
        ...games.map((g) =>
          button({ kind: "dup-join", gameId: g.id }, `Join ${g.name}`, ButtonStyle.Primary),
        ),
      ),
    );
  }
  parts.push(
    buttonRow(
      button({ kind: "dup-submit" }, "Submit anyway", ButtonStyle.Secondary),
      closeButton("Cancel"),
    ),
  );
  return payload(parts, true);
}

const newestFirst = (a: Suggestion, b: Suggestion): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

function decidedLine(s: Suggestion, categories: ReadonlyMap<number, Category>): string {
  const status =
    s.status === "rejected"
      ? `Rejected${rejection(s)}`
      : s.status === "approved"
        ? "Approved"
        : "Withdrawn";
  return `- **${text(s.name)}**${categorySuffix(categories, s.categoryId)}: ${status}`;
}

export function mySuggestionsView(
  suggestions: readonly Suggestion[],
  categoriesById: ReadonlyMap<number, Category>,
): Payload {
  const sorted = suggestions.toSorted(newestFirst);
  const pending = sorted.filter((s) => s.status === "pending").slice(0, PENDING_SHOWN);
  const decided = sorted.filter((s) => s.status !== "pending").slice(0, DECIDED_SHOWN);
  if (pending.length === 0 && decided.length === 0) {
    return payload(
      [display("You haven't suggested any games yet."), buttonRow(closeButton())],
      true,
    );
  }
  const parts: Part[] = [display("### My suggestions")];
  if (pending.length > 0) {
    parts.push(display("**Waiting for review**"));
    for (const s of pending) {
      parts.push(
        display(`**${text(s.name)}**${categorySuffix(categoriesById, s.categoryId)}`),
        buttonRow(button({ kind: "withdraw", suggestionId: s.id }, "Withdraw", ButtonStyle.Danger)),
      );
    }
  }
  if (decided.length > 0) {
    parts.push(
      display(`**Decided**\n${decided.map((s) => decidedLine(s, categoriesById)).join("\n")}`),
    );
  }
  parts.push(buttonRow(closeButton()));
  return payload(parts, true);
}

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
