import { MESSAGES } from "../constants.ts";
import { computeRoleOrder, validateGameName, parseAliases, text } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { normalize } from "../normalize.ts";
import { requireCategory, requireGame } from "./lookups.ts";
import { missingPermissionProblems, roleOrderProblem, templateRole } from "./permissions.ts";

import type { Game } from "../db/index.ts";
import type { RoleSnapshot } from "../discord/index.ts";
import type { AppContext } from "./context.ts";

/** A game edit as submitted: each field left out stays as it is. */
export type GameEdit = { name?: string; categoryId?: number; aliases?: string };

/** Returns the template role, or throws the exact fix for the admin. */
async function assertCanManageRoles(ctx: AppContext): Promise<RoleSnapshot> {
  const template = await templateRole(ctx);
  if (!template) throw new UserFacingError(MESSAGES.setupFirst);
  const problem =
    missingPermissionProblems(ctx, ["ManageRoles"])[0] ?? roleOrderProblem(ctx, template);
  if (problem !== null) throw new UserFacingError(problem);
  return template;
}

/** The roles of the stored games that still exist in Discord. */
export async function liveGameRoleIds(ctx: AppContext): Promise<string[]> {
  return (await ctx.repos.games.list())
    .map((g) => g.roleId)
    .filter((id) => ctx.gateway.role(id) !== undefined);
}

async function checkCollisions(
  ctx: AppContext,
  name: string,
  aliases: string[],
  selfId?: number,
): Promise<void> {
  const normalizedName = normalize(name);
  const games = await ctx.repos.games.list();
  const others = games.filter((g) => g.id !== selfId);
  for (const g of others) {
    if (normalize(g.name) === normalizedName) {
      throw new UserFacingError(`There's already a game called ${text(g.name)}.`);
    }
    if (g.aliases.some((a) => normalize(a) === normalizedName)) {
      throw new UserFacingError(
        `The alias ${text(normalizedName)} is already used by ${text(g.name)}.`,
      );
    }
  }
  // A game's name becomes a role members give themselves, so it mustn't pass for another role,
  // such as a staff one. Game roles (this game's own included) are covered above.
  const gameRoleIds = new Set(games.map((g) => g.roleId));
  const clash = ctx.gateway
    .roles()
    .find((r) => !gameRoleIds.has(r.id) && normalize(r.name) === normalizedName);
  if (clash) {
    throw new UserFacingError(`There's already a role called ${text(clash.name)} in this server.`);
  }
  for (const alias of aliases) {
    for (const g of others) {
      if (normalize(g.name) === alias || g.aliases.some((a) => normalize(a) === alias)) {
        throw new UserFacingError(`The alias ${text(alias)} is already used by ${text(g.name)}.`);
      }
    }
  }
}

export async function sortGameRoles(ctx: AppContext, actorId = "the bot"): Promise<void> {
  const templateId = await ctx.repos.setup.get("templateRoleId");
  if (templateId === undefined) return;
  const changes = computeRoleOrder(ctx.gateway.roles(), templateId, await liveGameRoleIds(ctx));
  if (changes.length > 0) {
    await ctx.gateway.setRolePositions(changes, `Game roles sorted for ${actorId}`);
  }
}

export async function addGame(
  ctx: AppContext,
  input: { name: string; categoryId: number; aliases: string; actorId: string },
): Promise<Game> {
  const template = await assertCanManageRoles(ctx);
  const name = validateGameName(input.name);
  const aliases = parseAliases(input.aliases);
  await requireCategory(ctx, input.categoryId);
  await checkCollisions(ctx, name, aliases);

  const role = await ctx.gateway.createRole(
    { name, color: template.color, mentionable: template.mentionable },
    `Game added by ${input.actorId}`,
  );
  let game: Game | undefined;
  try {
    game = await ctx.repos.games.add({
      name,
      categoryId: input.categoryId,
      roleId: role.id,
      aliases,
      addedBy: input.actorId,
      addedAt: ctx.now().toISOString(),
    });
    await sortGameRoles(ctx, input.actorId);
  } catch (error) {
    if (game) await ctx.repos.games.remove(game.id);
    try {
      await ctx.gateway.deleteRole(role.id, `Game add failed for ${input.actorId}`);
    } catch (cleanupError) {
      console.error(`Could not delete role ${role.id} after a failed game add`, cleanupError);
    }
    throw error;
  }
  await ctx.audit.log({ kind: "game-added", userId: input.actorId, game: game.name });
  return game;
}

/** Applies the fields of `patch` that differ from the game; `changed` is false when none did. */
export async function editGame(
  ctx: AppContext,
  gameId: number,
  patch: GameEdit,
  actorId: string,
): Promise<{ game: Game; changed: boolean }> {
  const game = await requireGame(ctx, gameId);

  const name = patch.name === undefined ? game.name : validateGameName(patch.name);
  const nameChanged = name !== game.name;
  const aliases = patch.aliases === undefined ? game.aliases : parseAliases(patch.aliases);
  const aliasesChanged = aliases.toSorted().join("\n") !== game.aliases.toSorted().join("\n");
  const category =
    patch.categoryId === undefined ? undefined : await requireCategory(ctx, patch.categoryId);
  const categoryChanged = category !== undefined && category.id !== game.categoryId;

  if (!nameChanged && !aliasesChanged && !categoryChanged) return { game, changed: false };
  if (nameChanged) await assertCanManageRoles(ctx);
  await checkCollisions(ctx, name, aliases, game.id);

  if (nameChanged && ctx.gateway.role(game.roleId)) {
    await ctx.gateway.editRole(game.roleId, { name }, `Game renamed by ${actorId}`);
  }
  const updated = await ctx.repos.games.update(game.id, {
    ...(nameChanged ? { name } : {}),
    ...(categoryChanged ? { categoryId: category.id } : {}),
    ...(aliasesChanged ? { aliases } : {}),
  });
  if (nameChanged) await sortGameRoles(ctx, actorId);

  const changes: string[] = [];
  if (nameChanged) changes.push(`renamed ${game.name} → ${name}`);
  if (categoryChanged) changes.push(`moved to ${category.name}`);
  if (aliasesChanged) changes.push(`aliases: ${aliases.length > 0 ? aliases.join(", ") : "none"}`);
  await ctx.audit.log({
    kind: "game-edited",
    userId: actorId,
    game: updated.name,
    changes: changes.join("; "),
  });
  return { game: updated, changed: true };
}

export async function removeGame(
  ctx: AppContext,
  gameId: number,
  actorId: string,
): Promise<{ game: Game; hadMembers: number }> {
  const game = await requireGame(ctx, gameId);
  await assertCanManageRoles(ctx);
  const hadMembers = ctx.gateway.roleMemberIds(game.roleId).length;
  if (ctx.gateway.role(game.roleId)) {
    await ctx.gateway.deleteRole(game.roleId, `Game removed by ${actorId}`);
  }
  await ctx.repos.games.remove(game.id);
  await ctx.audit.log({ kind: "game-removed", userId: actorId, game: game.name });
  return { game, hadMembers };
}

export async function reapplyTemplate(ctx: AppContext, actorId: string): Promise<number> {
  const template = await assertCanManageRoles(ctx);
  let count = 0;
  for (const game of await ctx.repos.games.list()) {
    if (!ctx.gateway.role(game.roleId)) continue;
    await ctx.gateway.editRole(
      game.roleId,
      { color: template.color, mentionable: template.mentionable },
      `Template reapplied by ${actorId}`,
    );
    count += 1;
  }
  await ctx.audit.log({ kind: "template-reapplied", userId: actorId, count });
  return count;
}
