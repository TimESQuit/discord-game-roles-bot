import { MESSAGES } from "../constants.ts";
import { text, validateCategoryName } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { requireCategory } from "./lookups.ts";

import type { MoveDirection } from "../constants.ts";
import type { Category } from "../db/index.ts";
import type { AppContext } from "./context.ts";

export async function addCategory(
  ctx: AppContext,
  rawName: string,
  actorId: string,
): Promise<Category> {
  const name = validateCategoryName(rawName, await ctx.repos.categories.list());
  const category = await ctx.repos.categories.add(name);
  await ctx.audit.log({ kind: "category-changed", userId: actorId, detail: `added ${name}` });
  return category;
}

/** Renames the category; `changed` is false when the new name is the current one. */
export async function renameCategory(
  ctx: AppContext,
  categoryId: number,
  rawName: string,
  actorId: string,
): Promise<{ previousName: string; name: string; changed: boolean }> {
  const category = await requireCategory(ctx, categoryId);
  const name = validateCategoryName(rawName, await ctx.repos.categories.list(), categoryId);
  const previousName = category.name;
  if (name === previousName) return { previousName, name, changed: false };
  await ctx.repos.categories.rename(categoryId, name);
  await ctx.audit.log({
    kind: "category-changed",
    userId: actorId,
    detail: `renamed ${previousName} → ${name}`,
  });
  return { previousName, name, changed: true };
}

/** Swaps the category with its neighbour; refuses to move the first up or the last down. */
export async function moveCategory(
  ctx: AppContext,
  categoryId: number,
  dir: MoveDirection,
  actorId: string,
): Promise<Category> {
  const categories = await ctx.repos.categories.list();
  const index = categories.findIndex((c) => c.id === categoryId);
  const category = categories[index];
  if (!category) throw new UserFacingError(MESSAGES.categoryGone);
  if (dir === "up" ? index === 0 : index === categories.length - 1) {
    throw new UserFacingError(
      `${text(category.name)} is already ${dir === "up" ? "first" : "last"}.`,
    );
  }
  await ctx.repos.categories.move(categoryId, dir);
  await ctx.audit.log({
    kind: "category-changed",
    userId: actorId,
    detail: `moved ${category.name} ${dir}`,
  });
  return category;
}
