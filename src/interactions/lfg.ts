import { DiscordAPIError } from "discord.js";
import type { Game } from "../db/index.ts";
import { UserFacingError } from "../errors.ts";
import {
  createLfgPost,
  joinFromLfg,
  respondToLfg,
  autocompleteGames,
  type AppContext,
} from "../services/index.ts";
import { LFG_FIELD, lfgModal, truncate, noticeView, pickGameView } from "../views/index.ts";
import { text, parseId } from "../domain/index.ts";
import { parsePositiveId } from "./parse.ts";
import { PRIVATE_V2_DEFER, forEdit, forReply } from "./replies.ts";
import { autocomplete, button, chatInput, modal, select, type Handlers } from "./router.ts";

const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

/** Posts, turning Discord's "no access / no permission" refusals into a private explanation. */
async function postHere(
  ctx: AppContext,
  input: Parameters<typeof createLfgPost>[1],
): Promise<void> {
  try {
    await createLfgPost(ctx, input);
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      (error.code === MISSING_ACCESS || error.code === MISSING_PERMISSIONS)
    ) {
      throw new UserFacingError("I can't post in this channel.");
    }
    throw error;
  }
}

/** Strictly parses a picked game ID and checks the game still exists (local read only). */
export async function resolvePickedGame(ctx: AppContext, raw: string | undefined): Promise<Game> {
  const id = parsePositiveId(raw, "Pick a game from the list.");
  const game = await ctx.repos.games.get(id);
  if (!game) throw new UserFacingError("That game no longer exists.");
  return game;
}

export const lfgHandlers: Handlers = {
  lfg: chatInput(async (ctx, interaction) => {
    const raw = interaction.options.getString("game", true).trim();
    if (!/^\d{1,15}$/.test(raw)) throw new UserFacingError("Pick a game from the list.");
    await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
    await postHere(ctx, {
      authorId: interaction.user.id,
      gameId: Number(raw),
      when: interaction.options.getString("when"),
      note: interaction.options.getString("note"),
      channelId: interaction.channelId,
    });
    await interaction.editReply(forEdit(noticeView("Posted.")));
  }),

  "autocomplete-lfg": autocomplete(async (ctx, interaction) => {
    const matches = await autocompleteGames(
      ctx,
      interaction.user.id,
      interaction.options.getFocused(),
      "any",
    );
    await interaction.respond(
      matches.map((game) => ({ name: truncate(game.name, 100), value: String(game.id) })),
    );
  }),

  "menu-lfg": button(async (ctx, interaction) => {
    const [categories, games] = await Promise.all([
      ctx.repos.categories.list(),
      ctx.repos.games.list(),
    ]);
    await interaction.reply(forReply(pickGameView("lfg", categories, games)));
  }),

  "pick-lfg": select(async (ctx, interaction) => {
    const game = await resolvePickedGame(ctx, interaction.values[0]);
    await interaction.showModal(lfgModal(game.id, "news"));
  }),

  "lfg-modal": modal(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "lfg-modal")
      throw new UserFacingError("That form has expired. Open it again.");
    await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
    let channelId: string;
    if (id.target === "news") {
      const news = await ctx.repos.setup.get("newsChannelId");
      if (!news) throw new UserFacingError("Run /gameadmin setup first.");
      channelId = news;
    } else {
      if (!interaction.channelId) throw new UserFacingError("I can't post in this channel.");
      channelId = interaction.channelId;
    }
    await postHere(ctx, {
      authorId: interaction.user.id,
      gameId: id.gameId,
      when: interaction.fields.getTextInputValue(LFG_FIELD.when),
      note: interaction.fields.getTextInputValue(LFG_FIELD.note),
      channelId,
    });
    await interaction.editReply(forEdit(noticeView(`Posted in <#${channelId}>.`)));
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
    await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
    const post = await ctx.repos.lfg.get(interaction.message.id);
    const result = await joinFromLfg(ctx, interaction.message.id, interaction.user.id);
    const name = text(post?.gameName ?? "this game");
    await interaction.editReply(
      forEdit(
        noticeView(result === "joined" ? `You've joined ${name}.` : `You already have ${name}.`),
      ),
    );
  }),
};
