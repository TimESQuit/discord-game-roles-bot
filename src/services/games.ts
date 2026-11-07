import { UserFacingError } from "../errors.ts";
import type { Game } from "../db/index.ts";
import type { RoleSnapshot } from "../discord/index.ts";
import { computeRoleOrder, validateGameName } from "../domain/index.ts";
import { normalize, parseAliases } from "../domain/index.ts";
import { text } from "../domain/index.ts";
import type { AppContext } from "./context.ts";

/** Returns the template role, or throws the exact fix for the admin. */
export async function assertCanManageRoles(ctx: AppContext): Promise<RoleSnapshot> {
  const templateId = await ctx.repos.setup.get("templateRoleId");
  const template = templateId === undefined ? undefined : ctx.gateway.role(templateId);
  if (!template) throw new UserFacingError("Run /gameadmin setup first.");
  if (ctx.gateway.missingBotPermissions(["ManageRoles"]).length > 0) {
    throw new UserFacingError(
      "Give the bot the Manage Roles permission in Server Settings → Roles.",
    );
  }
  if (ctx.gateway.botTopRolePosition() <= template.position) {
    throw new UserFacingError(
      "Move the bot's role above Game role template in Server Settings → Roles",
    );
  }
  return template;
}

async function checkCollisions(
  ctx: AppContext,
  name: string,
  aliases: string[],
  selfId?: number,
): Promise<void> {
  const normalizedName = normalize(name);
  const others = (await ctx.repos.games.list()).filter((g) => g.id !== selfId);
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
  for (const alias of aliases) {
    for (const g of others) {
      if (normalize(g.name) === alias || g.aliases.some((a) => normalize(a) === alias)) {
        throw new UserFacingError(`The alias ${text(alias)} is already used by ${text(g.name)}.`);
      }
    }
  }
}

async function requireCategory(ctx: AppContext, categoryId: number) {
  const category = await ctx.repos.categories.get(categoryId);
  if (!category) throw new UserFacingError("That category doesn't exist.");
  return category;
}

export async function sortGameRoles(ctx: AppContext, actorId = "the bot"): Promise<void> {
  const templateId = await ctx.repos.setup.get("templateRoleId");
  if (templateId === undefined) return;
  const roleIds = (await ctx.repos.games.list())
    .map((g) => g.roleId)
    .filter((id) => ctx.gateway.role(id) !== undefined);
  const changes = computeRoleOrder(ctx.gateway.roles(), templateId, roleIds);
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

export async function editGame(
  ctx: AppContext,
  gameId: number,
  patch: { name?: string; categoryId?: number; aliases?: string },
  actorId: string,
): Promise<Game> {
  const game = await ctx.repos.games.get(gameId);
  if (!game) throw new UserFacingError("That game no longer exists.");

  const name = patch.name === undefined ? game.name : validateGameName(patch.name);
  const nameChanged = name !== game.name;
  const aliases = patch.aliases === undefined ? game.aliases : parseAliases(patch.aliases);
  const aliasesChanged = [...aliases].sort().join("\n") !== [...game.aliases].sort().join("\n");
  const category =
    patch.categoryId === undefined ? undefined : await requireCategory(ctx, patch.categoryId);
  const categoryChanged = category !== undefined && category.id !== game.categoryId;

  if (!nameChanged && !aliasesChanged && !categoryChanged) return game;
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
  return updated;
}

export async function removeGame(
  ctx: AppContext,
  gameId: number,
  actorId: string,
): Promise<{ game: Game; hadMembers: number }> {
  const game = await ctx.repos.games.get(gameId);
  if (!game) throw new UserFacingError("That game no longer exists.");
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
