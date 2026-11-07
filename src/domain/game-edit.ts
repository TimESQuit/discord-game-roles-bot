import type { Game } from "../db/index.ts";
import { parseAliases } from "./search.ts";

const collapse = (name: string): string => name.trim().replace(/\s+/g, " ");

/** The fields of a submitted edit that differ from the game. Omitted fields are not compared. */
export function diffGameEdit(
  game: Game,
  submitted: { name?: string; categoryId?: number; aliases?: string },
): { name?: string; categoryId?: number; aliases?: string } {
  const patch: { name?: string; categoryId?: number; aliases?: string } = {};
  if (submitted.name !== undefined && collapse(submitted.name) !== game.name) {
    patch.name = submitted.name;
  }
  if (submitted.categoryId !== undefined && submitted.categoryId !== game.categoryId) {
    patch.categoryId = submitted.categoryId;
  }
  if (submitted.aliases !== undefined) {
    const next = parseAliases(submitted.aliases).toSorted().join("\n");
    if (next !== game.aliases.toSorted().join("\n")) patch.aliases = submitted.aliases;
  }
  return patch;
}
