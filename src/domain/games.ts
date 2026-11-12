import { GAME_NAME_MAX } from "../constants.ts";
import { UserFacingError } from "../errors.ts";
import { normalize } from "../normalize.ts";

/** Squeezes runs of whitespace into single spaces and checks the name is usable. */
export function validateGameName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (normalize(name) === "") {
    throw new UserFacingError("Game names need at least one letter or number.");
  }
  if (name.length > GAME_NAME_MAX) {
    throw new UserFacingError(`Game names can be at most ${GAME_NAME_MAX} characters.`);
  }
  return name;
}
