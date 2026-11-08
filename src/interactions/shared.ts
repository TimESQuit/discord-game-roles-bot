import { TEXT_LIMIT } from "../constants.ts";
import { text } from "../domain/index.ts";
import { requireGame } from "../services/index.ts";
import { FIELD, pickGameView, truncate } from "../views/index.ts";
import { parseCategoryId, parseGameId } from "./parse.ts";

import type { ApplicationCommandOptionChoiceData, ModalSubmitInteraction } from "discord.js";
import type { Category, Game } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { PickPurpose } from "../domain/index.ts";
import type { AppContext } from "../services/index.ts";

/** Strictly parses a picked game ID and checks the game still exists (local read only). */
export const resolvePickedGame = async (ctx: AppContext, raw: string | undefined): Promise<Game> =>
  requireGame(ctx, parseGameId(raw));

/** The category picked in a modal's category dropdown. */
export const modalCategory = (interaction: ModalSubmitInteraction): number =>
  parseCategoryId(interaction.fields.getStringSelectValues(FIELD.category)[0]);

/** Every category and game, as the pickers and the add menu show them. */
export async function catalog(ctx: AppContext): Promise<{ categories: Category[]; games: Game[] }> {
  const [categories, games] = await Promise.all([
    ctx.repos.categories.list(),
    ctx.repos.games.list(),
  ]);
  return { categories, games };
}

/** The single-choice game picker for `purpose`. */
export async function gamePicker(
  ctx: AppContext,
  purpose: PickPurpose,
  page = 0,
): Promise<Payload> {
  const { categories, games } = await catalog(ctx);
  return pickGameView(purpose, categories, games, page);
}

/** Categories keyed by ID, for views that name a suggestion's category. */
export async function categoriesById(ctx: AppContext): Promise<Map<number, Category>> {
  return new Map((await ctx.repos.categories.list()).map((c) => [c.id, c]));
}

/** The reply after a join attempt; `name` is the raw game name. */
export const joinedNotice = (result: "joined" | "already", name: string): string =>
  result === "joined" ? `You've joined ${text(name)}.` : `You already have ${text(name)}.`;

/** Autocomplete choices: the name (cut to fit) shown, the ID sent back. */
export const choices = (
  items: readonly { id: number; name: string }[],
): ApplicationCommandOptionChoiceData<string>[] =>
  items.map((item) => ({ name: truncate(item.name, TEXT_LIMIT), value: String(item.id) }));
