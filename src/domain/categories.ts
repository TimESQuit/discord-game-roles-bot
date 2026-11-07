import { CATEGORY_NAME_MAX } from "../constants.ts";
import { UserFacingError } from "../errors.ts";
import { text } from "./text.ts";

/** Trims the name and checks length and uniqueness (ignoring case). `selfId` is the category being renamed. */
export function validateCategoryName(
  raw: string,
  existing: readonly { id: number; name: string }[],
  selfId?: number,
): string {
  const name = raw.trim();
  if (name === "") throw new UserFacingError("Give the category a name.");
  if (Array.from(name).length > CATEGORY_NAME_MAX) {
    throw new UserFacingError(`Category names can be at most ${CATEGORY_NAME_MAX} characters.`);
  }
  const lower = name.toLowerCase();
  if (existing.some((c) => c.id !== selfId && c.name.trim().toLowerCase() === lower)) {
    throw new UserFacingError(`There's already a category called ${text(name)}.`);
  }
  return name;
}
