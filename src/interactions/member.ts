import { MESSAGES } from "../constants.ts";
import { isAdmin, text, parseId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import {
  applySelection,
  autocompleteGames,
  gamesInCommon,
  gamesOf,
  join,
  leave,
  requireGame,
  whoPlays,
} from "../services/index.ts";
import {
  addGamesPageOf,
  changedOptionIds,
  addGamesView,
  gameListView,
  menuView,
  myGamesView,
  peopleListView,
  removeGamesView,
} from "../views/index.ts";
import { closeIfPresent, openMenus } from "./menus.ts";
import { parseGameId } from "./parse.ts";
import { noticePrivately, showPrivately, updateWith } from "./replies.ts";
import { autocomplete, button, chatInput, memberRoleIds, select, userContext } from "./router.ts";
import { catalog, choices, gamePicker, roleNotice } from "./shared.ts";

import type { ButtonInteraction, ChatInputCommandInteraction } from "discord.js";
import type { Payload } from "../discord/index.ts";
import type { AppContext } from "../services/index.ts";
import type { Handlers } from "./router.ts";

const joinNames = (games: readonly { name: string }[]): string =>
  games.map((g) => text(g.name)).join(", ");

function summary(result: {
  added: readonly { name: string }[];
  removed: readonly { name: string }[];
  missing: readonly { name: string }[];
}): string {
  const parts: string[] = [];
  if (result.added.length > 0) parts.push(`Added ${joinNames(result.added)}.`);
  if (result.removed.length > 0) parts.push(`Removed ${joinNames(result.removed)}.`);
  if (parts.length === 0) parts.push("No changes.");
  if (result.missing.length > 0) {
    parts.push(`Couldn't change: ${joinNames(result.missing)} (its role is missing).`);
  }
  return parts.join(" ");
}

function openMenu(
  ctx: AppContext,
  interaction: ButtonInteraction | ChatInputCommandInteraction,
): Promise<void> {
  const admin = isAdmin(memberRoleIds(interaction), ctx.config.adminRoleId);
  return showPrivately(interaction, menuView({ isAdmin: admin }));
}

async function addGames(ctx: AppContext, userId: string, page: number): Promise<Payload> {
  const { categories, games } = await catalog(ctx);
  return addGamesView(categories, games, ctx.gateway.memberRoleIds(userId), page);
}

const mine = async (ctx: AppContext, userId: string): Promise<Payload> =>
  myGamesView(await gamesOf(ctx, userId));

/** The `game` option is an autocomplete value: a game ID as a string. */
const gameIdOption = (interaction: ChatInputCommandInteraction): number =>
  parseGameId(interaction.options.getString("game", true));

async function showWho(ctx: AppContext, gameId: number): Promise<Payload> {
  const game = await requireGame(ctx, gameId);
  return peopleListView(
    `Who plays ${text(game.name)}`,
    await whoPlays(ctx, gameId),
    "Nobody has this game yet.",
  );
}

async function commandJoinLeave(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  action: "join" | "leave",
): Promise<void> {
  const gameId = gameIdOption(interaction);
  await noticePrivately(interaction, async () => {
    const game = await requireGame(ctx, gameId);
    if (action === "join") {
      return roleNotice(await join(ctx, interaction.user.id, gameId, "command"), game.name);
    }
    return roleNotice(await leave(ctx, interaction.user.id, gameId, "command"), game.name);
  });
}

/** Shared by all four pick-page-* handlers; the router already checked admin rights. */
async function pickPage(ctx: AppContext, interaction: ButtonInteraction): Promise<void> {
  const id = parseId(interaction.customId);
  if (id?.kind !== "pick-page") throw new UserFacingError(MESSAGES.menuExpired);
  await updateWith(interaction, () => gamePicker(ctx, id.purpose, id.page));
}

export const memberHandlers: Handlers = {
  "panel-open": button(async (ctx, interaction) => {
    await openMenu(ctx, interaction);
  }),
  "games-menu": chatInput(async (ctx, interaction) => {
    await openMenu(ctx, interaction);
  }),

  "menu-add": button(async (ctx, interaction) => {
    await updateWith(interaction, () => addGames(ctx, interaction.user.id, 0));
  }),
  "menu-remove": button(async (ctx, interaction) => {
    await updateWith(interaction, async () =>
      removeGamesView(await gamesOf(ctx, interaction.user.id)),
    );
  }),
  "menu-mine": button(async (ctx, interaction) => {
    await updateWith(interaction, () => mine(ctx, interaction.user.id));
  }),
  "menu-who": button(async (ctx, interaction) => {
    await updateWith(interaction, () => gamePicker(ctx, "who"));
  }),

  "add-select": select(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "add-select") throw new UserFacingError(MESSAGES.menuExpired);
    // Only options whose tick differs from what this menu showed may change, so a stale menu
    // can never touch a role the person did not tick or untick.
    const rendered = interaction.component?.options;
    if (rendered === undefined) throw new UserFacingError(MESSAGES.menuExpired);
    await updateWith(interaction, async () => {
      const { categories, games } = await catalog(ctx);
      const userId = interaction.user.id;
      const result = await applySelection(
        ctx,
        userId,
        changedOptionIds(rendered, interaction.values),
        interaction.values,
        "panel",
      );
      const roleIds = new Set(ctx.gateway.memberRoleIds(userId));
      for (const g of result.added) roleIds.add(g.roleId);
      for (const g of result.removed) roleIds.delete(g.roleId);
      const page = addGamesPageOf(categories, games, id.categoryId, id.chunk);
      return addGamesView(categories, games, roleIds, page, summary(result));
    });
  }),
  "add-page": button(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "add-page") throw new UserFacingError(MESSAGES.menuExpired);
    await updateWith(interaction, () => addGames(ctx, interaction.user.id, id.page));
  }),
  "remove-select": select(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "remove-select") throw new UserFacingError(MESSAGES.menuExpired);
    await updateWith(interaction, async () => {
      const userId = interaction.user.id;
      const removed = [];
      for (const value of interaction.values) {
        const game = await ctx.repos.games.get(parseGameId(value));
        if (game !== undefined && (await leave(ctx, userId, game.id, "panel")) === "left") {
          removed.push(game);
        }
      }
      const notice = removed.length > 0 ? `Removed ${joinNames(removed)}.` : "No changes.";
      return removeGamesView(await gamesOf(ctx, userId), notice);
    });
  }),
  "pick-who": select(async (ctx, interaction) => {
    await updateWith(interaction, () => showWho(ctx, parseGameId(interaction.values[0])));
  }),
  "pick-page-who": button(pickPage),
  "pick-page-lfg": button(pickPage),
  "pick-page-edit": button(pickPage),
  "pick-page-remove": button(pickPage),
  close: button(async (_ctx, interaction) => {
    await interaction.deferUpdate();
    await closeIfPresent(() => interaction.deleteReply());
    openMenus.forget(interaction.user.id, interaction.message.id);
  }),

  "games-add": chatInput((ctx, interaction) => commandJoinLeave(ctx, interaction, "join")),
  "games-remove": chatInput((ctx, interaction) => commandJoinLeave(ctx, interaction, "leave")),
  "games-mine": chatInput(async (ctx, interaction) => {
    await showPrivately(interaction, await mine(ctx, interaction.user.id));
  }),
  "games-who": chatInput(async (ctx, interaction) => {
    const gameId = gameIdOption(interaction);
    await showPrivately(interaction, await showWho(ctx, gameId));
  }),

  "autocomplete-games": autocomplete(async (ctx, interaction) => {
    const sub = interaction.options.getSubcommand(false);
    const mode = sub === "add" ? "add" : sub === "remove" ? "remove" : "any";
    const focused = interaction.options.getFocused();
    await interaction.respond(
      choices(await autocompleteGames(ctx, interaction.user.id, focused, mode)),
    );
  }),

  "ctx-see-games": userContext(async (ctx, interaction) => {
    const games = await gamesOf(ctx, interaction.targetId);
    await showPrivately(
      interaction,
      gameListView(
        `Games <@${interaction.targetId}> plays`,
        games,
        "They haven't picked any games.",
      ),
    );
  }),
  "ctx-in-common": userContext(async (ctx, interaction) => {
    const games = await gamesInCommon(ctx, interaction.user.id, interaction.targetId);
    await showPrivately(
      interaction,
      gameListView(
        `Games you share with <@${interaction.targetId}>`,
        games,
        "You have no games in common.",
      ),
    );
  }),
};
