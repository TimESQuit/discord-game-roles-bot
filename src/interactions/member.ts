import {
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionEditReplyOptions,
  type StringSelectMenuInteraction,
  type UserContextMenuCommandInteraction,
} from "discord.js";
import { isAdmin } from "../domain/roles.ts";
import { UserFacingError } from "../errors.ts";
import {
  applySelection,
  autocompleteGames,
  gamesInCommon,
  gamesOf,
  join,
  leave,
  whoPlays,
} from "../services/membership.ts";
import type { AppContext } from "../services/context.ts";
import type { Payload } from "../discord/gateway.ts";
import { truncate } from "../views/limits.ts";
import {
  addGamesPageOf,
  addGamesView,
  categoryChunks,
  gameListView,
  menuView,
  myGamesView,
  noticeView,
  ownedChunks,
  peopleListView,
  pickGameView,
  removeGamesView,
} from "../views/member.ts";
import { text } from "../views/text.ts";
import { parseId } from "./custom-ids.ts";
import { memberRoleIds, type Handlers } from "./router.ts";

/** Edits keep the layout flag and never resend the ephemeral flag. */
const forEdit = (view: Payload): InteractionEditReplyOptions =>
  ({
    components: view.components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: view.allowedMentions,
  }) as InteractionEditReplyOptions;

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

function openMenu(ctx: AppContext, interaction: Interaction): Promise<unknown> {
  const admin = isAdmin(memberRoleIds(interaction), ctx.config.adminRoleId);
  return (interaction as ButtonInteraction).reply(menuView({ isAdmin: admin }) as never);
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
  if (!Number.isInteger(id)) throw new UserFacingError("Pick a game from the list.");
  return id;
}

async function gameName(ctx: AppContext, gameId: number): Promise<string> {
  const game = await ctx.repos.games.get(gameId);
  if (!game) throw new UserFacingError("That game no longer exists.");
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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const name = await gameName(ctx, gameId);
  let reply: string;
  if (action === "join") {
    const result = await join(ctx, interaction.user.id, gameId, "command");
    reply = result === "joined" ? `You've joined ${name}.` : `You already have ${name}.`;
  } else {
    const result = await leave(ctx, interaction.user.id, gameId, "command");
    reply = result === "left" ? `You've left ${name}.` : `You don't have ${name}.`;
  }
  await interaction.editReply({ content: reply });
}

export const memberHandlers: Handlers = {
  "panel-open": async (ctx, interaction: ButtonInteraction) => {
    await openMenu(ctx, interaction);
  },
  "games-menu": async (ctx, interaction: ChatInputCommandInteraction) => {
    await openMenu(ctx, interaction);
  },

  "menu-add": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await showAddGames(ctx, interaction, 0);
  },
  "menu-remove": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(removeGamesView(await gamesOf(ctx, interaction.user.id))));
  },
  "menu-mine": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await showMine(ctx, interaction);
  },
  "menu-who": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    const [categories, games] = await Promise.all([
      ctx.repos.categories.list(),
      ctx.repos.games.list(),
    ]);
    await interaction.editReply(forEdit(pickGameView("who", categories, games)));
  },

  "add-select": async (ctx, interaction: StringSelectMenuInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "add-select")
      throw new UserFacingError("That menu has expired. Open it again.");
    await interaction.deferUpdate();
    const [categories, games] = await Promise.all([
      ctx.repos.categories.list(),
      ctx.repos.games.list(),
    ]);
    const shown = categoryChunks(games, id.categoryId)[id.chunk] ?? [];
    const userId = interaction.user.id;
    const result = await applySelection(
      ctx,
      userId,
      shown.map((g) => g.id),
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
  },
  "add-page": async (ctx, interaction: ButtonInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "add-page") throw new UserFacingError("That menu has expired. Open it again.");
    await interaction.deferUpdate();
    await showAddGames(ctx, interaction, id.page);
  },
  "remove-select": async (ctx, interaction: StringSelectMenuInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "remove-select") {
      throw new UserFacingError("That menu has expired. Open it again.");
    }
    await interaction.deferUpdate();
    const userId = interaction.user.id;
    const shown = ownedChunks(await gamesOf(ctx, userId))[id.chunk] ?? [];
    const selected = new Set(interaction.values);
    const removed = [];
    for (const game of shown) {
      if (
        selected.has(String(game.id)) &&
        (await leave(ctx, userId, game.id, "panel")) === "left"
      ) {
        removed.push(game);
      }
    }
    const notice = removed.length > 0 ? `Removed ${joinNames(removed)}.` : "No changes.";
    await interaction.editReply(forEdit(removeGamesView(await gamesOf(ctx, userId), notice)));
  },
  "pick-who": async (ctx, interaction: StringSelectMenuInteraction) => {
    await interaction.deferUpdate();
    const gameId = Number(interaction.values[0]);
    if (!Number.isInteger(gameId)) throw new UserFacingError("Pick a game from the list.");
    await interaction.editReply(forEdit(await showWho(ctx, gameId)));
  },
  cancel: async (_ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(noticeView("Cancelled.")));
  },

  "games-add": (ctx, interaction: ChatInputCommandInteraction) =>
    commandJoinLeave(ctx, interaction, "join"),
  "games-remove": (ctx, interaction: ChatInputCommandInteraction) =>
    commandJoinLeave(ctx, interaction, "leave"),
  "games-mine": async (ctx, interaction: ChatInputCommandInteraction) => {
    await interaction.reply(myGamesView(await gamesOf(ctx, interaction.user.id)) as never);
  },
  "games-who": async (ctx, interaction: ChatInputCommandInteraction) => {
    const gameId = gameIdOption(interaction);
    await interaction.reply((await showWho(ctx, gameId)) as never);
  },

  "autocomplete-games": async (ctx, interaction: AutocompleteInteraction) => {
    const sub = interaction.options.getSubcommand(false);
    const mode = sub === "add" ? "add" : sub === "remove" ? "remove" : "any";
    const focused = interaction.options.getFocused();
    const matches = await autocompleteGames(ctx, interaction.user.id, focused, mode);
    await interaction.respond(
      matches.map((game) => ({ name: truncate(game.name, 100), value: String(game.id) })),
    );
  },

  "ctx-see-games": async (ctx, interaction: UserContextMenuCommandInteraction) => {
    const games = await gamesOf(ctx, interaction.targetId);
    await interaction.reply(
      gameListView(
        `Games <@${interaction.targetId}> plays`,
        games,
        "They haven't picked any games.",
      ) as never,
    );
  },
  "ctx-in-common": async (ctx, interaction: UserContextMenuCommandInteraction) => {
    const games = await gamesInCommon(ctx, interaction.user.id, interaction.targetId);
    await interaction.reply(
      gameListView(
        `Games you share with <@${interaction.targetId}>`,
        games,
        "You have no games in common.",
      ) as never,
    );
  },
};
