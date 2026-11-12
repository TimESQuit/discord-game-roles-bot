import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";

import { PEOPLE_SHOWN_MAX, TEXT_DISPLAY_LIMIT, TEXT_LIMIT } from "../constants.ts";
import { encodeId } from "../domain/index.ts";
import { truncate } from "./limits.ts";

import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIButtonComponentWithCustomId,
  APIComponentInContainer,
  APIContainerComponent,
  APIStringSelectComponent,
  APITextDisplayComponent,
} from "discord.js";
import type { Payload } from "../discord/index.ts";
import type { CustomId } from "../domain/index.ts";

const PUBLIC = [MessageFlags.IsComponentsV2] as const;
const PRIVATE = [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] as const;
const NO_PINGS = { parse: [] } as const;

export type ButtonRow = APIActionRowComponent<APIButtonComponent>;
export type Row = ButtonRow | APIActionRowComponent<APIStringSelectComponent>;
export type Part = APIComponentInContainer | Row;

/** A text display, cut to the per-display limit. */
export const display = (content: string): APITextDisplayComponent => ({
  type: ComponentType.TextDisplay,
  content: truncate(content, TEXT_DISPLAY_LIMIT),
});

export const separator = (): APIComponentInContainer => ({ type: ComponentType.Separator });

export const button = (
  id: CustomId,
  label: string,
  style: APIButtonComponentWithCustomId["style"] = ButtonStyle.Secondary,
  disabled = false,
): APIButtonComponent => ({
  type: ComponentType.Button,
  style,
  label: truncate(label, TEXT_LIMIT),
  custom_id: encodeId(id),
  ...(disabled ? { disabled } : {}),
});

/** Deletes the private message it sits on: "Close" on menus and lists, "Cancel" on confirmations. */
export const closeButton = (label: "Close" | "Cancel" = "Close"): APIButtonComponent =>
  button({ kind: "close" }, label);

export const buttonRow = (...buttons: APIButtonComponent[]): ButtonRow => ({
  type: ComponentType.ActionRow,
  components: buttons,
});

export const container = (...components: Part[]): APIContainerComponent => ({
  type: ComponentType.Container,
  components,
});

/**
 * Posts the message without push, desktop or email notifications, like Discord's @silent.
 * It still shows as unread. For posts nobody needs to be alerted to.
 */
export const silent = (view: Payload): Payload => ({
  ...view,
  flags: [...(view.flags ?? []), MessageFlags.SuppressNotifications],
});

/** A components-v2 message holding one container; mentions never ping. */
export const payload = (parts: Part[], privateMessage: boolean): Payload => ({
  flags: privateMessage ? PRIVATE : PUBLIC,
  components: [container(...parts)],
  allowedMentions: NO_PINGS,
});

/** Mentions of the first people (capped), and the "…and N more" line when there are others. */
export function shownPeople(ids: readonly string[]): { mentions: string[]; more: string | null } {
  const mentions = ids.slice(0, PEOPLE_SHOWN_MAX).map((id) => `<@${id}>`);
  const hidden = ids.length - mentions.length;
  return { mentions, more: hidden > 0 ? `…and ${String(hidden)} more` : null };
}
