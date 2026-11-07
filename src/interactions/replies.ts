import {
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from "discord.js";
import type { Payload } from "../discord/index.ts";

/**
 * Defer flags for a private layout V2 reply: Ephemeral | IsComponentsV2 (64 | 32768).
 * discord.js types `deferReply` flags as Ephemeral only, although Discord needs the V2 flag on
 * the deferred reply for a later edit to carry V2 components. A numeric string is the one form
 * both the types and the runtime (BitField.resolve) accept, so no cast is needed; the test in
 * replies.test.ts pins the value to the enum arithmetic.
 */
export const PRIVATE_V2_DEFER = "32832";

/** Edits keep the layout flag and never resend the ephemeral flag. */
export const forEdit = (view: Payload): InteractionEditReplyOptions => ({
  components: view.components,
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: view.allowedMentions,
});

export const forReply = (view: Payload): InteractionReplyOptions => ({
  components: view.components,
  flags: view.flags,
  allowedMentions: view.allowedMentions,
});
