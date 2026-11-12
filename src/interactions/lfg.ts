import { MESSAGES } from "../constants.ts";
import { DISCORD_ERROR, isDiscordError } from "../discord/index.ts";
import { parseId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import {
  autocompleteGames,
  createLfgPost,
  joinFromLfg,
  lfgChannel,
  respondToLfg,
} from "../services/index.ts";
import { LFG_FIELD, lfgModal } from "../views/index.ts";
import { parseGameId } from "./parse.ts";
import { forReply, noticePrivately } from "./replies.ts";
import { autocomplete, button, chatInput, modal, select } from "./router.ts";
import { choices, gamePicker, joinedNotice, resolvePickedGame } from "./shared.ts";

import type { BaseInteraction } from "discord.js";
import type { AppContext } from "../services/index.ts";
import type { Handlers } from "./router.ts";

const CANNOT_POST = "I can't post in this channel.";

/** Where the member started, and whether they could post there themselves. */
function startedFrom(interaction: BaseInteraction): {
  channelId: string | null;
  memberCanSend: boolean;
} {
  const needed = interaction.channel?.isThread() ? "SendMessagesInThreads" : "SendMessages";
  return {
    channelId: interaction.channelId,
    memberCanSend: interaction.memberPermissions?.has(needed) ?? false,
  };
}

/**
 * Posts where `lfgChannel` says, turning Discord's "no access / no permission" refusals into a
 * private explanation. Resolves to the line telling the member where the post went.
 */
async function postLfg(
  ctx: AppContext,
  interaction: BaseInteraction,
  input: Omit<Parameters<typeof createLfgPost>[1], "authorId" | "channelId">,
): Promise<string> {
  const channelId = await lfgChannel(ctx, startedFrom(interaction));
  try {
    await createLfgPost(ctx, { ...input, authorId: interaction.user.id, channelId });
  } catch (error) {
    if (isDiscordError(error, DISCORD_ERROR.missingAccess, DISCORD_ERROR.missingPermissions)) {
      throw new UserFacingError(CANNOT_POST);
    }
    throw error;
  }
  return `Posted in <#${channelId}>.`;
}

export const lfgHandlers: Handlers = {
  lfg: chatInput(async (ctx, interaction) => {
    const gameId = parseGameId(interaction.options.getString("game", true));
    await noticePrivately(interaction, () =>
      postLfg(ctx, interaction, {
        gameId,
        when: interaction.options.getString("when"),
        note: interaction.options.getString("note"),
      }),
    );
  }),

  "autocomplete-lfg": autocomplete(async (ctx, interaction) => {
    const matches = await autocompleteGames(
      ctx,
      interaction.user.id,
      interaction.options.getFocused(),
      "any",
    );
    await interaction.respond(choices(matches));
  }),

  "menu-lfg": button(async (ctx, interaction) => {
    await interaction.reply(forReply(await gamePicker(ctx, "lfg")));
  }),

  "pick-lfg": select(async (ctx, interaction) => {
    const game = await resolvePickedGame(ctx, interaction.values[0]);
    await interaction.showModal(lfgModal(game.id));
  }),

  "lfg-modal": modal(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "lfg-modal") throw new UserFacingError(MESSAGES.formExpired);
    // The form stays in the channel the menu was opened in, so this is where the member started.
    await noticePrivately(interaction, () =>
      postLfg(ctx, interaction, {
        gameId: id.gameId,
        when: interaction.fields.getTextInputValue(LFG_FIELD.when),
        note: interaction.fields.getTextInputValue(LFG_FIELD.note),
      }),
    );
  }),

  "lfg-in": button(async (ctx, interaction) => {
    await interaction.deferUpdate();
    await respondToLfg(ctx, interaction.message.id, interaction.user.id, "in");
  }),
  "lfg-maybe": button(async (ctx, interaction) => {
    await interaction.deferUpdate();
    await respondToLfg(ctx, interaction.message.id, interaction.user.id, "maybe");
  }),

  "lfg-join": button(async (ctx, interaction) => {
    await noticePrivately(interaction, async () => {
      const post = await ctx.repos.lfg.get(interaction.message.id);
      const result = await joinFromLfg(ctx, interaction.message.id, interaction.user.id);
      return joinedNotice(result, post?.gameName ?? "this game");
    });
  }),
};
