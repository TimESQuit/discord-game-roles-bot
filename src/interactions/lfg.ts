import { MESSAGES } from "../constants.ts";
import { DISCORD_ERROR, isDiscordError } from "../discord/index.ts";
import { parseId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { createLfgPost, joinFromLfg, respondToLfg, autocompleteGames } from "../services/index.ts";
import { LFG_FIELD, lfgModal } from "../views/index.ts";
import { parseGameId } from "./parse.ts";
import { forReply, noticePrivately } from "./replies.ts";
import { autocomplete, button, chatInput, modal, select } from "./router.ts";
import { choices, gamePicker, joinedNotice, resolvePickedGame } from "./shared.ts";

import type { AppContext } from "../services/index.ts";
import type { Handlers } from "./router.ts";

const CANNOT_POST = "I can't post in this channel.";

/** Posts, turning Discord's "no access / no permission" refusals into a private explanation. */
async function postHere(
  ctx: AppContext,
  input: Parameters<typeof createLfgPost>[1],
): Promise<void> {
  try {
    await createLfgPost(ctx, input);
  } catch (error) {
    if (isDiscordError(error, DISCORD_ERROR.missingAccess, DISCORD_ERROR.missingPermissions)) {
      throw new UserFacingError(CANNOT_POST);
    }
    throw error;
  }
}

export const lfgHandlers: Handlers = {
  lfg: chatInput(async (ctx, interaction) => {
    const gameId = parseGameId(interaction.options.getString("game", true));
    await noticePrivately(interaction, async () => {
      await postHere(ctx, {
        authorId: interaction.user.id,
        gameId,
        when: interaction.options.getString("when"),
        note: interaction.options.getString("note"),
        channelId: interaction.channelId,
      });
      return "Posted.";
    });
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
    await interaction.showModal(lfgModal(game.id, "news"));
  }),

  "lfg-modal": modal(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "lfg-modal") throw new UserFacingError(MESSAGES.formExpired);
    await noticePrivately(interaction, async () => {
      let channelId: string;
      if (id.target === "news") {
        const news = await ctx.repos.setup.get("newsChannelId");
        if (!news) throw new UserFacingError(MESSAGES.setupFirst);
        channelId = news;
      } else {
        if (!interaction.channelId) throw new UserFacingError(CANNOT_POST);
        channelId = interaction.channelId;
      }
      await postHere(ctx, {
        authorId: interaction.user.id,
        gameId: id.gameId,
        when: interaction.fields.getTextInputValue(LFG_FIELD.when),
        note: interaction.fields.getTextInputValue(LFG_FIELD.note),
        channelId,
      });
      return `Posted in <#${channelId}>.`;
    });
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
