import { SELECT_OPTION_LIMIT } from "../constants.ts";
import type { Game } from "../db/index.ts";
import { diffSelection, byName, rankGames } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import type { AppContext } from "./context.ts";
import type { Source } from "./audit.ts";

async function requireGame(ctx: AppContext, gameId: number): Promise<Game> {
  const game = await ctx.repos.games.get(gameId);
  if (!game) throw new UserFacingError("That game no longer exists.");
  return game;
}

export async function applySelection(
  ctx: AppContext,
  userId: string,
  shownGameIds: readonly number[],
  selectedGameIds: readonly string[],
  source: Source,
): Promise<{ added: Game[]; removed: Game[]; missing: Game[] }> {
  const shown = new Set(shownGameIds);
  const selected = new Set<number>();
  for (const value of selectedGameIds) {
    const id = Number(value);
    if (Number.isInteger(id) && shown.has(id)) selected.add(id);
  }

  const shownGames: Game[] = [];
  for (const id of new Set(shownGameIds)) {
    const game = await ctx.repos.games.get(id);
    if (game) shownGames.push(game);
  }
  const present = shownGames.filter((g) => ctx.gateway.role(g.roleId) !== undefined);
  const missing = shownGames.filter((g) => ctx.gateway.role(g.roleId) === undefined);

  const { add, remove } = diffSelection(
    present.map((g) => g.roleId),
    ctx.gateway.memberRoleIds(userId),
    present.filter((g) => selected.has(g.id)).map((g) => g.roleId),
  );
  const added = present.filter((g) => add.includes(g.roleId));
  const removed = present.filter((g) => remove.includes(g.roleId));

  for (const game of added) {
    await ctx.gateway.addMemberRole(userId, game.roleId, `Joined ${game.name} via ${source}`);
    await ctx.audit.log({ kind: "joined", userId, game: game.name, source });
  }
  for (const game of removed) {
    await ctx.gateway.removeMemberRole(userId, game.roleId, `Left ${game.name} via ${source}`);
    await ctx.audit.log({ kind: "left", userId, game: game.name, source });
  }
  if (missing.length > 0) {
    await ctx.audit.notifyAdmins(
      `These games' roles are missing in Discord: ${missing.map((g) => g.name).join(", ")}. Remove the games or recreate them.`,
    );
  }
  return { added, removed, missing };
}

export async function join(
  ctx: AppContext,
  userId: string,
  gameId: number,
  source: Source,
): Promise<"joined" | "already"> {
  const game = await requireGame(ctx, gameId);
  if (!ctx.gateway.role(game.roleId)) {
    await ctx.audit.notifyAdmins(
      `The role for ${game.name} is missing in Discord. Remove the game or recreate it.`,
    );
    throw new UserFacingError("That game's role is missing; the admins have been told.");
  }
  if (ctx.gateway.memberRoleIds(userId).has(game.roleId)) return "already";
  await ctx.gateway.addMemberRole(userId, game.roleId, `Joined ${game.name} via ${source}`);
  await ctx.audit.log({ kind: "joined", userId, game: game.name, source });
  return "joined";
}

export async function leave(
  ctx: AppContext,
  userId: string,
  gameId: number,
  source: Source,
): Promise<"left" | "not-member"> {
  const game = await requireGame(ctx, gameId);
  if (!ctx.gateway.memberRoleIds(userId).has(game.roleId)) return "not-member";
  await ctx.gateway.removeMemberRole(userId, game.roleId, `Left ${game.name} via ${source}`);
  await ctx.audit.log({ kind: "left", userId, game: game.name, source });
  return "left";
}

export async function gamesOf(ctx: AppContext, userId: string): Promise<Game[]> {
  const roles = ctx.gateway.memberRoleIds(userId);
  return (await ctx.repos.games.list()).filter((g) => roles.has(g.roleId)).toSorted(byName);
}

export async function whoPlays(ctx: AppContext, gameId: number): Promise<string[]> {
  const game = await ctx.repos.games.get(gameId);
  return game ? ctx.gateway.roleMemberIds(game.roleId) : [];
}

export async function gamesInCommon(ctx: AppContext, a: string, b: string): Promise<Game[]> {
  const rolesA = ctx.gateway.memberRoleIds(a);
  const rolesB = ctx.gateway.memberRoleIds(b);
  return (await ctx.repos.games.list())
    .filter((g) => rolesA.has(g.roleId) && rolesB.has(g.roleId))
    .toSorted(byName);
}

/** Reads only SQLite and the member cache, never a Discord API. */
export async function autocompleteGames(
  ctx: AppContext,
  userId: string,
  query: string,
  mode: "add" | "remove" | "any",
): Promise<Game[]> {
  const roles = ctx.gateway.memberRoleIds(userId);
  let pool = (await ctx.repos.games.list()).toSorted(byName);
  if (mode === "add") pool = pool.filter((g) => !roles.has(g.roleId));
  if (mode === "remove") pool = pool.filter((g) => roles.has(g.roleId));
  if (mode === "add" && query.trim() === "") {
    const counts = new Map(pool.map((g) => [g.id, ctx.gateway.roleMemberIds(g.roleId).length]));
    pool = pool.toSorted(
      (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || byName(a, b),
    );
  }
  return rankGames(query, pool, SELECT_OPTION_LIMIT);
}
