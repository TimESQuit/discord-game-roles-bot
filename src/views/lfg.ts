import {
  ButtonStyle,
  ComponentType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
} from "discord.js";
import type { Game, LfgPost } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import { encodeId, type CustomId } from "../domain/index.ts";
import { truncate } from "./limits.ts";
import { text } from "../domain/index.ts";

/** Field IDs inside the LFG modal (read back with `interaction.fields`). */
export const LFG_FIELD = { when: "when", note: "note" } as const;

const TEXT_DISPLAY_MAX = 4000;
const LIST_SHOWN = 50;

const people = (label: string, ids: readonly string[]): string => {
  const shown = ids.slice(0, LIST_SHOWN).map((id) => `<@${id}>`);
  if (ids.length > LIST_SHOWN) shown.push(`…and ${String(ids.length - LIST_SHOWN)} more`);
  return `${label} (${String(ids.length)}):${shown.length === 0 ? "" : ` ${shown.join(", ")}`}`;
};

const button = (
  id: CustomId,
  label: string,
  style: ButtonStyle.Success | ButtonStyle.Secondary | ButtonStyle.Primary,
): APIButtonComponent => ({
  type: ComponentType.Button,
  style,
  label,
  custom_id: encodeId(id),
});

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
  const buttons: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      button({ kind: "lfg-in" }, "I'm in", ButtonStyle.Success),
      button({ kind: "lfg-maybe" }, "Maybe", ButtonStyle.Secondary),
      button({ kind: "lfg-join" }, "Join this game's role", ButtonStyle.Primary),
    ],
  };
  const inner: APIContainerComponent = {
    type: ComponentType.Container,
    components: [
      { type: ComponentType.TextDisplay, content: truncate(head.join("\n"), TEXT_DISPLAY_MAX) },
      { type: ComponentType.Separator },
      {
        type: ComponentType.TextDisplay,
        content: truncate(
          `${people("In", post.in)}\n${people("Maybe", post.maybe)}`,
          TEXT_DISPLAY_MAX,
        ),
      },
      buttons,
    ],
  };
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [inner],
    allowedMentions: game ? { roles: [game.roleId], parse: [] } : { parse: [] },
  };
}

export function lfgModal(gameId: number, target: "news" | "here"): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(encodeId({ kind: "lfg-modal", gameId, target }))
    .setTitle("Looking for group")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("When (optional)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(LFG_FIELD.when)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(false)
            .setPlaceholder("tonight 9pm"),
        ),
      new LabelBuilder()
        .setLabel("Note (optional)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(LFG_FIELD.note)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(300)
            .setRequired(false),
        ),
    );
}
