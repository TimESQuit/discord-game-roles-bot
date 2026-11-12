import { InteractionType } from "discord.js";

import { MESSAGES } from "../constants.ts";
import { parseId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";

import type { CustomId, CustomIdKind } from "../domain/index.ts";

/** A strict positive integer ID (select value or autocomplete option); anything else throws `message`. */
export function parsePositiveId(raw: string | undefined, message: string): number {
  const trimmed = (raw ?? "").trim();
  if (!/^\d{1,15}$/.test(trimmed) || Number(trimmed) <= 0) throw new UserFacingError(message);
  return Number(trimmed);
}

/** A game ID from a game dropdown or a `game` autocomplete option. */
export const parseGameId = (raw: string | undefined): number =>
  parsePositiveId(raw, MESSAGES.pickGame);

/** A category ID from a category dropdown or a `category` autocomplete option. */
export const parseCategoryId = (raw: string | undefined): number =>
  parsePositiveId(raw, MESSAGES.pickCategory);

type IdOf<K extends CustomIdKind> = Extract<CustomId, { kind: K }>;

const isOneOf = <K extends CustomIdKind>(id: CustomId | null, kinds: readonly K[]): id is IdOf<K> =>
  kinds.some((kind) => kind === id?.kind);

/**
 * The parsed custom ID of the component or modal a handler was routed for, typed by its kind so
 * its arguments can be read. Anything else means the menu (or, for a modal, the form) is stale.
 */
export function idOf<K extends CustomIdKind>(
  interaction: { customId: string; type: InteractionType },
  ...kinds: K[]
): IdOf<K> {
  const id = parseId(interaction.customId);
  if (isOneOf(id, kinds)) return id;
  throw new UserFacingError(
    interaction.type === InteractionType.ModalSubmit ? MESSAGES.formExpired : MESSAGES.menuExpired,
  );
}
