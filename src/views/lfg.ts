import { ButtonStyle, MessageFlags, ModalBuilder, TextInputStyle } from "discord.js";

import { LFG_WHEN_MAX, NOTE_MAX } from "../constants.ts";
import { encodeId, text } from "../domain/index.ts";
import {
  button,
  buttonRow,
  closeButton,
  container,
  display,
  payload,
  separator,
  shownPeople,
} from "./components.ts";
import { inputLabel, textInput } from "./modals.ts";

import type { Game, LfgOutcome, LfgPost } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";

/** Field IDs inside the LFG modal (read back with `interaction.fields`). */
export const LFG_FIELD = { when: "when", note: "note" } as const;

const people = (label: string, ids: readonly string[]): string => {
  const { mentions, more } = shownPeople(ids);
  const shown = more === null ? mentions : [...mentions, more];
  return `${label} (${String(ids.length)}):${shown.length === 0 ? "" : ` ${shown.join(", ")}`}`;
};

/**
 * The public LFG post (layout V2, no `content`). The game role is mentioned in a text display,
 * which pings in V2 messages when `allowedMentions.roles` lists it. Only that role is allowed;
 * the service forces `{ parse: [] }` on edits so responding never re-pings.
 */
export function lfgPostView(post: LfgPost, game: Game | null): Payload {
  const head = [`<@${post.authorId}> is looking for a group: **${text(post.gameName)}**`];
  if (post.when) head.push(`When: ${text(post.when)}`);
  if (post.note) head.push(text(post.note));
  head.push(game ? `<@&${game.roleId}>` : "(this game has been removed)");
  return {
    flags: [MessageFlags.IsComponentsV2],
    components: [
      container(
        display(head.join("\n")),
        separator(),
        display(
          `${people("In", post.in)}\n${people("Maybe", post.maybe)}\n-# Click your answer again to remove it.`,
        ),
        buttonRow(
          button({ kind: "lfg-in" }, "I'm in", ButtonStyle.Success),
          button({ kind: "lfg-maybe" }, "Maybe"),
          button({ kind: "lfg-role" }, "Join / leave role", ButtonStyle.Primary),
          button({ kind: "lfg-manage" }, "Manage"),
        ),
      ),
    ],
    allowedMentions: game ? { roles: [game.roleId], parse: [] } : { parse: [] },
  };
}

/**
 * What an LFG post becomes once it is finished or cancelled: one line, plus who went when it
 * finished. No buttons, and the mentions never ping.
 */
export function lfgClosedView(post: LfgPost, outcome: LfgOutcome, closedBy: string): Payload {
  const head = `**${text(post.gameName)}** LFG, ${outcome} by <@${closedBy}>`;
  return payload(
    [display(outcome === "finished" ? `${head}\n${people("Went", post.in)}` : head)],
    false,
  );
}

/** The private menu the starter or an admin gets from Manage. */
export function lfgManageView(post: LfgPost): Payload {
  const { messageId } = post;
  return payload(
    [
      display(`Close the **${text(post.gameName)}** LFG post? Its buttons go away either way.`),
      buttonRow(
        button({ kind: "lfg-finish", messageId }, "Finish", ButtonStyle.Success),
        button({ kind: "lfg-cancel", messageId }, "Cancel post", ButtonStyle.Danger),
        closeButton(),
      ),
    ],
    true,
  );
}

export function lfgModal(gameId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(encodeId({ kind: "lfg-modal", gameId }))
    .setTitle("Looking for group")
    .addLabelComponents(
      inputLabel(
        "When (optional)",
        textInput(LFG_FIELD.when, TextInputStyle.Short, LFG_WHEN_MAX, false).setPlaceholder(
          "tonight 9pm",
        ),
      ),
      inputLabel(
        "Note (optional)",
        textInput(LFG_FIELD.note, TextInputStyle.Paragraph, NOTE_MAX, false),
      ),
    );
}
