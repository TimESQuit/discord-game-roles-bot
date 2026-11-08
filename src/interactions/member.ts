import { MESSAGES, TEXT_LIMIT } from "../constants.ts";
import { isAdmin, text, parseId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import {
  applySelection,
  autocompleteGames,
  gamesInCommon,
  gamesOf,
  join,
  leave,
  whoPlays,
} from "../services/index.ts";
import {
  truncate,
  addGamesPageOf,
  changedOptionIds,
  addGamesView,
  gameListView,
  menuView,
  myGamesView,
  noticeView,
  peopleListView,
  pickGameView,
  removeGamesView,
} from "../views/index.ts";
import { PRIVATE_V2_DEFER, forEdit, forReply } from "./replies.ts";
import { autocomplete, button, chatInput, memberRoleIds, select, userContext } from "./router.ts";

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
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
): Promise<unknown> {
  const admin = isAdmin(memberRoleIds(interaction), ctx.config.adminRoleId);
  return interaction.reply(forReply(menuView({ isAdmin: admin })));
}

async function showAddGames(
  ctx: AppContext,
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  page: number,
  notice?: string,
  roleIds?: ReadonlySet<string>,
): Promise<void> {
  const [categories, games] = await Promise.all([
    ctx.repos.categories.list(),
    ctx.repos.games.list(),
  ]);
  const owned = roleIds ?? ctx.gateway.memberRoleIds(interaction.user.id);
  await interaction.editReply(forEdit(addGamesView(categories, games, owned, page, notice)));
}

async function showMine(ctx: AppContext, interaction: ButtonInteraction): Promise<void> {
  await interaction.editReply(forEdit(myGamesView(await gamesOf(ctx, interaction.user.id))));
}

/** The `game` option is an autocomplete value: a game ID as a string. */
function gameIdOption(interaction: ChatInputCommandInteraction): number {
  const raw = interaction.options.getString("game", true).trim();
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(id)) throw new UserFacingError(MESSAGES.pickGame);
  return id;
}

async function gameName(ctx: AppContext, gameId: number): Promise<string> {
  const game = await ctx.repos.games.get(gameId);
  if (!game) throw new UserFacingError(MESSAGES.gameGone);
  return text(game.name);
}

async function showWho(ctx: AppContext, gameId: number): Promise<Payload> {
  const name = await gameName(ctx, gameId);
  return peopleListView(
    `Who plays ${name}`,
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
  await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
  const name = await gameName(ctx, gameId);
  let reply: string;
  if (action === "join") {
    const result = await join(ctx, interaction.user.id, gameId, "command");
    reply = result === "joined" ? `You've joined ${name}.` : `You already have ${name}.`;
  } else {
    const result = await leave(ctx, interaction.user.id, gameId, "command");
    reply = result === "left" ? `You've left ${name}.` : `You don't have ${name}.`;
  }
  await interaction.editReply(forEdit(noticeView(reply)));
}

/** Shared by all four pick-page-* handlers; the router already checked admin rights. */
async function pickPage(ctx: AppContext, interaction: ButtonInteraction): Promise<void> {
  const id = parseId(interaction.customId);
  if (id?.kind !== "pick-page") throw new UserFacingError(MESSAGES.menuExpired);
  await interaction.deferUpdate();
  const [categories, games] = await Promise.all([
    ctx.repos.categories.list(),
    ctx.repos.games.list(),
  ]);
  await interaction.editReply(forEdit(pickGameView(id.purpose, categories, games, id.page)));
}

export const memberHandlers: Handlers = {
  "panel-open": button(async (ctx, interaction) => {
    await openMenu(ctx, interaction);
  }),
  "games-menu": chatInput(async (ctx, interaction) => {
    await openMenu(ctx, interaction);
  }),

  "menu-add": button(async (ctx, interaction) => {
    await interaction.deferUpdate();
    await showAddGames(ctx, interaction, 0);
  }),
  "menu-remove": button(async (ctx, interaction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(removeGamesView(await gamesOf(ctx, interaction.user.id))));
  }),
  "menu-mine": button(async (ctx, interaction) => {
    await interaction.deferUpdate();
    await showMine(ctx, interaction);
  }),
  "menu-who": button(async (ctx, interaction) => {
    await interaction.deferUpdate();
    const [categories, games] = await Promise.all([
      ctx.repos.categories.list(),
      ctx.repos.games.list(),
    ]);
    await interaction.editReply(forEdit(pickGameView("who", categories, games)));
  }),

  "add-select": select(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "add-select") throw new UserFacingError(MESSAGES.menuExpired);
    await interaction.deferUpdate();
    const [categories, games] = await Promise.all([
      ctx.repos.categories.list(),
      ctx.repos.games.list(),
    ]);
    // Only options whose tick differs from what this menu showed may change, so a stale menu
    // can never touch a role the person did not tick or untick.
    const rendered = interaction.component?.options;
    if (rendered === undefined) throw new UserFacingError(MESSAGES.menuExpired);
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
    await interaction.editReply(
      forEdit(addGamesView(categories, games, roleIds, page, summary(result))),
    );
  }),
  "add-page": button(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "add-page") throw new UserFacingError(MESSAGES.menuExpired);
    await interaction.deferUpdate();
    await showAddGames(ctx, interaction, id.page);
  }),
  "remove-select": select(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "remove-select") {
      throw new UserFacingError(MESSAGES.menuExpired);
    }
    await interaction.deferUpdate();
    const userId = interaction.user.id;
    const removed = [];
    for (const value of interaction.values) {
      const game = await ctx.repos.games.get(Number(value));
      if (game !== undefined && (await leave(ctx, userId, game.id, "panel")) === "left") {
        removed.push(game);
      }
    }
    const notice = removed.length > 0 ? `Removed ${joinNames(removed)}.` : "No changes.";
    await interaction.editReply(forEdit(removeGamesView(await gamesOf(ctx, userId), notice)));
  }),
  "pick-who": select(async (ctx, interaction) => {
    await interaction.deferUpdate();
    const gameId = Number(interaction.values[0]);
    if (!Number.isInteger(gameId)) throw new UserFacingError(MESSAGES.pickGame);
    await interaction.editReply(forEdit(await showWho(ctx, gameId)));
  }),
  "pick-page-who": button(pickPage),
  "pick-page-lfg": button(pickPage),
  "pick-page-edit": button(pickPage),
  "pick-page-remove": button(pickPage),
  cancel: button(async (_ctx, interaction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(noticeView("Cancelled.")));
  }),

  "games-add": chatInput((ctx, interaction) => commandJoinLeave(ctx, interaction, "join")),
  "games-remove": chatInput((ctx, interaction) => commandJoinLeave(ctx, interaction, "leave")),
  "games-mine": chatInput(async (ctx, interaction) => {
    await interaction.reply(forReply(myGamesView(await gamesOf(ctx, interaction.user.id))));
  }),
  "games-who": chatInput(async (ctx, interaction) => {
    const gameId = gameIdOption(interaction);
    await interaction.reply(forReply(await showWho(ctx, gameId)));
  }),

  "autocomplete-games": autocomplete(async (ctx, interaction) => {
    const sub = interaction.options.getSubcommand(false);
    const mode = sub === "add" ? "add" : sub === "remove" ? "remove" : "any";
    const focused = interaction.options.getFocused();
    const matches = await autocompleteGames(ctx, interaction.user.id, focused, mode);
    await interaction.respond(
      matches.map((game) => ({ name: truncate(game.name, TEXT_LIMIT), value: String(game.id) })),
    );
  }),

  "ctx-see-games": userContext(async (ctx, interaction) => {
    const games = await gamesOf(ctx, interaction.targetId);
    await interaction.reply(
      forReply(
        gameListView(
          `Games <@${interaction.targetId}> plays`,
          games,
          "They haven't picked any games.",
        ),
      ),
    );
  }),
  "ctx-in-common": userContext(async (ctx, interaction) => {
    const games = await gamesInCommon(ctx, interaction.user.id, interaction.targetId);
    await interaction.reply(
      forReply(
        gameListView(
          `Games you share with <@${interaction.targetId}>`,
          games,
          "You have no games in common.",
        ),
      ),
    );
  }),
};
