import {
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from "discord.js";
import type { Payload } from "../discord/index.ts";

/** Edits keep the layout flag and never resend the ephemeral flag. */
export const forEdit = (view: Payload): InteractionEditReplyOptions =>
  ({
    components: view.components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: view.allowedMentions,
  }) as InteractionEditReplyOptions;

export const forReply = (view: Payload): InteractionReplyOptions =>
  ({
    components: view.components,
    flags: view.flags,
    allowedMentions: view.allowedMentions,
  }) as InteractionReplyOptions;
