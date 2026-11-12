import { MAX_PENDING_SUGGESTIONS, MESSAGES } from "../constants.ts";
import { validateGameName, findCloseMatches, text } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { announcementView, reviewCardView } from "../views/index.ts";
import { addGame } from "./games.ts";
import {
  requireCategory,
  requirePendingSuggestion,
  requireSuggestion,
  alreadyDecided,
} from "./lookups.ts";
import { join } from "./membership.ts";

import type { Game, Suggestion } from "../db/index.ts";
import type { AppContext } from "./context.ts";

/** Claims a pending suggestion (first wins) or throws with its current status. */
async function claim(
  ctx: AppContext,
  id: number,
  to: "approved" | "rejected" | "withdrawn",
  by: string,
  reason?: string,
): Promise<Suggestion> {
  await requireSuggestion(ctx, id);
  const won = await ctx.repos.suggestions.decide(id, to, by, ctx.now().toISOString(), reason);
  const current = await requireSuggestion(ctx, id);
  if (!won) throw alreadyDecided(current.status);
  return current;
}

/** Re-renders the review card. A deleted card is ignored; other failures notify the admins. */
async function refreshCard(ctx: AppContext, id: number): Promise<void> {
  try {
    const s = await requireSuggestion(ctx, id);
    const adminChannelId = await ctx.repos.setup.get("adminChannelId");
    if (!s.reviewMessageId || adminChannelId === undefined) return;
    const category = await ctx.repos.categories.get(s.categoryId);
    await ctx.gateway.edit(adminChannelId, s.reviewMessageId, reviewCardView(s, category?.name));
  } catch (error) {
    console.error(`Could not update the review card for suggestion ${id}`, error);
    await ctx.audit.reportError(`Could not update the review card for suggestion #${id}.`);
  }
}

export async function closeMatches(
  ctx: AppContext,
  name: string,
): Promise<{ games: Game[]; pending: { id: number; name: string }[] }> {
  const games = findCloseMatches(name, await ctx.repos.games.list());
  const pending = findCloseMatches(
    name,
    (await ctx.repos.suggestions.pendingNames()).map((p) => ({ ...p, aliases: [] })),
  ).map((p) => ({ id: p.id, name: p.name }));
  return { games, pending };
}

export async function submitSuggestion(
  ctx: AppContext,
  input: { userId: string; name: string; categoryId: number; note: string | null },
): Promise<Suggestion> {
  const name = validateGameName(input.name);
  const category = await requireCategory(ctx, input.categoryId);
  const adminChannelId = await ctx.repos.setup.get("adminChannelId");
  if (adminChannelId === undefined) throw new UserFacingError(MESSAGES.setupFirst);
  if ((await ctx.repos.suggestions.countPending(input.userId)) >= MAX_PENDING_SUGGESTIONS) {
    throw new UserFacingError(
      `You already have ${MAX_PENDING_SUGGESTIONS} pending suggestions. Withdraw one or wait for an admin to review them.`,
    );
  }
  const s = await ctx.repos.suggestions.add({
    suggesterId: input.userId,
    name,
    categoryId: category.id,
    note: input.note,
    createdAt: ctx.now().toISOString(),
  });
  try {
    const messageId = await ctx.gateway.send(adminChannelId, reviewCardView(s, category.name));
    await ctx.repos.suggestions.setReviewMessage(s.id, messageId);
  } catch (error) {
    console.error(`Could not post the review card for suggestion ${s.id}`, error);
    await ctx.repos.suggestions.remove(s.id);
    await ctx.audit.reportError(
      `Could not post a review card for the suggestion **${text(name)}**. Check the bot's permissions in this channel.`,
    );
    throw new UserFacingError("Couldn't post your suggestion for review. Please try again later.");
  }
  await ctx.audit.log({ kind: "suggested", userId: input.userId, name });
  return (await ctx.repos.suggestions.get(s.id)) ?? s;
}

export async function approveSuggestion(
  ctx: AppContext,
  id: number,
  adminId: string,
): Promise<Game> {
  const s = await claim(ctx, id, "approved", adminId);
  let game: Game;
  try {
    game = await addGame(ctx, {
      name: s.name,
      categoryId: s.categoryId,
      aliases: s.aliases ?? "",
      actorId: adminId,
    });
  } catch (error) {
    await ctx.repos.suggestions.undoDecision(id);
    throw error;
  }
  try {
    await ctx.repos.suggestions.setGame(id, game.id);
  } catch (error) {
    console.error(`Could not link suggestion ${id} to game ${game.id}`, error);
    await ctx.audit.reportError(`Could not link suggestion #${id} to ${game.name}.`);
  }

  if (ctx.gateway.memberRoleIds(s.suggesterId).size > 0) {
    try {
      await join(ctx, s.suggesterId, game.id, "suggestion");
    } catch (error) {
      console.error(`Could not add ${s.suggesterId} to ${game.name}`, error);
      await ctx.audit.reportError(`Could not add the suggester to ${game.name}.`);
    }
  }
  try {
    const newsChannelId = await ctx.repos.setup.get("newsChannelId");
    if (newsChannelId === undefined) throw new Error("newsChannelId is not set");
    await ctx.gateway.send(newsChannelId, announcementView(game));
  } catch (error) {
    console.error(`Could not announce ${game.name}`, error);
    await ctx.audit.reportError(`Could not announce ${game.name} in the news channel.`);
  }
  await refreshCard(ctx, id);
  await ctx.audit.log({ kind: "suggestion-approved", userId: adminId, name: game.name });
  return game;
}

export async function editSuggestion(
  ctx: AppContext,
  id: number,
  patch: { name?: string; categoryId?: number; aliases?: string },
  adminId: string,
): Promise<Suggestion> {
  await requirePendingSuggestion(ctx, id);
  const name = patch.name === undefined ? undefined : validateGameName(patch.name);
  if (patch.categoryId !== undefined) await requireCategory(ctx, patch.categoryId);
  const wrote = await ctx.repos.suggestions.updatePending(id, {
    ...(name === undefined ? {} : { name }),
    ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
    ...(patch.aliases === undefined ? {} : { aliases: patch.aliases }),
  });
  if (!wrote) throw alreadyDecided((await requireSuggestion(ctx, id)).status);
  const updated = await requireSuggestion(ctx, id);
  await refreshCard(ctx, id);
  await ctx.audit.log({ kind: "suggestion-edited", userId: adminId, name: updated.name });
  return updated;
}

export async function rejectSuggestion(
  ctx: AppContext,
  id: number,
  adminId: string,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed === "") throw new UserFacingError("Please give a reason.");
  const s = await claim(ctx, id, "rejected", adminId, trimmed);
  await refreshCard(ctx, id);
  await ctx.audit.log({
    kind: "suggestion-rejected",
    userId: adminId,
    name: s.name,
    reason: trimmed,
  });
}

export async function withdrawSuggestion(
  ctx: AppContext,
  id: number,
  userId: string,
): Promise<void> {
  const existing = await requireSuggestion(ctx, id);
  if (existing.suggesterId !== userId) {
    throw new UserFacingError("You can only withdraw your own suggestions.");
  }
  const s = await claim(ctx, id, "withdrawn", userId);
  await refreshCard(ctx, id);
  await ctx.audit.log({ kind: "suggestion-withdrawn", userId, name: s.name });
}
