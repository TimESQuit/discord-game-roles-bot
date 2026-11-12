import { beforeEach, describe, expect, test } from "vitest";

import { MESSAGES } from "../constants.ts";
import { UserFacingError } from "../errors.ts";
import { A1, defined, makeContext } from "../testing/index.ts";
import { addCategory, moveCategory, renameCategory } from "./categories.ts";

import type { Category } from "../db/index.ts";
import type { TestContext } from "../testing/index.ts";

let ctx: TestContext;
let first: Category;
let middle: Category;
let last: Category;

beforeEach(async () => {
  ctx = await makeContext();
  const categories = await ctx.repos.categories.list();
  [first, middle, last] = [
    defined(categories[0]),
    defined(categories[1]),
    defined(categories.at(-1)),
  ];
  ctx.logLines.splice(0);
});

const order = async () => (await ctx.repos.categories.list()).map((c) => c.id);

describe("addCategory", () => {
  test("stores the trimmed name at the end and logs it", async () => {
    const added = await addCategory(ctx, "  Party  ", A1);
    expect(added.name).toBe("Party");
    expect((await order()).at(-1)).toBe(added.id);
    expect(ctx.logLines).toHaveLength(1);
  });

  test("a taken name is refused and nothing is stored or logged", async () => {
    const before = await order();
    await expect(addCategory(ctx, first.name.toUpperCase(), A1)).rejects.toThrow(UserFacingError);
    expect(await order()).toEqual(before);
    expect(ctx.logLines).toEqual([]);
  });
});

describe("renameCategory", () => {
  test("renames and logs", async () => {
    const result = await renameCategory(ctx, middle.id, "Relaxed", A1);
    expect(result).toEqual({ previousName: middle.name, name: "Relaxed", changed: true });
    expect((await ctx.repos.categories.get(middle.id))?.name).toBe("Relaxed");
    expect(ctx.logLines).toHaveLength(1);
  });

  test("the same name is a no-op with no log line; a new case is a change", async () => {
    expect((await renameCategory(ctx, middle.id, ` ${middle.name} `, A1)).changed).toBe(false);
    expect(ctx.logLines).toEqual([]);
    const recased = middle.name.toUpperCase();
    expect((await renameCategory(ctx, middle.id, recased, A1)).changed).toBe(true);
    expect((await ctx.repos.categories.get(middle.id))?.name).toBe(recased);
  });

  test("another category's name or an unknown category is refused", async () => {
    await expect(renameCategory(ctx, middle.id, first.name, A1)).rejects.toThrow(UserFacingError);
    await expect(renameCategory(ctx, 9999, "X", A1)).rejects.toThrow(MESSAGES.categoryGone);
    expect((await ctx.repos.categories.get(middle.id))?.name).toBe(middle.name);
    expect(ctx.logLines).toEqual([]);
  });
});

describe("moveCategory", () => {
  test("swaps with the neighbour in that direction and logs", async () => {
    await moveCategory(ctx, middle.id, "up", A1);
    expect((await order()).slice(0, 2)).toEqual([middle.id, first.id]);
    await moveCategory(ctx, middle.id, "down", A1);
    expect((await order()).slice(0, 2)).toEqual([first.id, middle.id]);
    expect(ctx.logLines).toHaveLength(2);
  });

  test("the first can't go up and the last can't go down; nothing changes", async () => {
    const before = await order();
    await expect(moveCategory(ctx, first.id, "up", A1)).rejects.toThrow(UserFacingError);
    await expect(moveCategory(ctx, last.id, "down", A1)).rejects.toThrow(UserFacingError);
    expect(await order()).toEqual(before);
    expect(ctx.logLines).toEqual([]);
  });

  test("an unknown category is refused", async () => {
    await expect(moveCategory(ctx, 9999, "up", A1)).rejects.toThrow(MESSAGES.categoryGone);
  });
});
