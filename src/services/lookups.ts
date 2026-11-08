import { MESSAGES } from "../constants.ts";
import { UserFacingError } from "../errors.ts";

import type { Category, Game, Suggestion } from "../db/index.ts";
import type { AppContext } from "./context.ts";

export async function requireGame(ctx: AppContext, gameId: number): Promise<Game> {
  const game = await ctx.repos.games.get(gameId);
  if (!game) throw new UserFacingError(MESSAGES.gameGone);
  return game;
}

export async function requireCategory(ctx: AppContext, categoryId: number): Promise<Category> {
  const category = await ctx.repos.categories.get(categoryId);
  if (!category) throw new UserFacingError(MESSAGES.categoryGone);
  return category;
}

export async function requireSuggestion(ctx: AppContext, id: number): Promise<Suggestion> {
  const suggestion = await ctx.repos.suggestions.get(id);
  if (!suggestion) throw new UserFacingError(MESSAGES.suggestionGone);
  return suggestion;
}

export const alreadyDecided = (status: string): UserFacingError =>
  new UserFacingError(`This suggestion was already ${status}.`);

export async function requirePendingSuggestion(ctx: AppContext, id: number): Promise<Suggestion> {
  const suggestion = await requireSuggestion(ctx, id);
  if (suggestion.status !== "pending") throw alreadyDecided(suggestion.status);
  return suggestion;
}
