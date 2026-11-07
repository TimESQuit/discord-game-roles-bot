import { ButtonStyle, ComponentType } from "discord.js";
import type { Game, LfgPost } from "../db/types.ts";
import type { Payload } from "../discord/gateway.ts";
import { text } from "./text.ts";

const mentions = (ids: readonly string[]): string =>
  ids.length === 0 ? "" : ` ${ids.map((id) => `<@${id}>`).join(", ")}`;

/** Minimal LFG post; Task 18 finishes the layout. Mentions are controlled by the caller. */
export function lfgPostView(post: LfgPost, game: Game | null): Payload {
  const lines = [`<@${post.authorId}> is looking for a group: **${text(post.gameName)}**`];
  if (post.when) lines.push(`When: ${text(post.when)}`);
  if (post.note) lines.push(text(post.note));
  lines.push(game ? `<@&${game.roleId}>` : "(this game has been removed)");
  lines.push(`In (${post.in.length}):${mentions(post.in)}`);
  lines.push(`Maybe (${post.maybe.length}):${mentions(post.maybe)}`);
  const button = (id: string, label: string, style: ButtonStyle) => ({
    type: ComponentType.Button as const,
    style,
    label,
    custom_id: id,
  });
  return {
    content: lines.join("\n"),
    allowedMentions: { parse: [] },
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          button("gr:lfg-in", "I'm in", ButtonStyle.Success),
          button("gr:lfg-maybe", "Maybe", ButtonStyle.Secondary),
          button("gr:lfg-join", "Join this game's role", ButtonStyle.Primary),
        ],
      },
    ],
  };
}
