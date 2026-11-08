import { ButtonStyle, MessageFlags, ModalBuilder, TextInputStyle } from "discord.js";

import { LFG_WHEN_MAX, NOTE_MAX } from "../constants.ts";
import { encodeId, text } from "../domain/index.ts";
import { button, buttonRow, container, display, separator, shownPeople } from "./components.ts";
import { inputLabel, textInput } from "./modals.ts";

import type { Game, LfgPost } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { LfgTarget } from "../domain/index.ts";

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
        display(`${people("In", post.in)}\n${people("Maybe", post.maybe)}`),
        buttonRow(
          button({ kind: "lfg-in" }, "I'm in", ButtonStyle.Success),
          button({ kind: "lfg-maybe" }, "Maybe"),
          button({ kind: "lfg-join" }, "Join this game's role", ButtonStyle.Primary),
        ),
      ),
    ],
    allowedMentions: game ? { roles: [game.roleId], parse: [] } : { parse: [] },
  };
}

export function lfgModal(gameId: number, target: LfgTarget): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(encodeId({ kind: "lfg-modal", gameId, target }))
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
