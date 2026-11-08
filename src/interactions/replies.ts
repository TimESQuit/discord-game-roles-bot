import { MessageFlags } from "discord.js";

import { noticeView } from "../views/index.ts";

import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageComponentInteraction,
  ModalMessageModalSubmitInteraction,
  RepliableInteraction,
} from "discord.js";
import type { Payload } from "../discord/index.ts";

/**
 * Defer flags for a private layout V2 reply: Ephemeral | IsComponentsV2 (64 | 32768).
 * discord.js types `deferReply` flags as Ephemeral only, although Discord needs the V2 flag on
 * the deferred reply for a later edit to carry V2 components. The types also accept a numeric
 * string (`${bigint}`), and the runtime (BitField.resolve) reads one, so the V2 member goes in
 * as the template-literal form of the enum value. No cast is needed, and the value is derived
 * from the enum; the test in replies.test.ts pins it to the enum arithmetic.
 */
export const PRIVATE_V2_DEFER = [MessageFlags.Ephemeral, `${MessageFlags.IsComponentsV2}`] as const;

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

/** Acknowledges a component (or a modal opened from one), then replaces its message with the view `render` builds. */
export async function updateWith(
  interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction,
  render: () => Promise<Payload>,
): Promise<void> {
  await interaction.deferUpdate();
  await interaction.editReply(forEdit(await render()));
}

/** Defers a private reply, then fills it with the view `render` builds. */
export async function replyPrivately(
  interaction: RepliableInteraction,
  render: () => Promise<Payload>,
): Promise<void> {
  await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
  await interaction.editReply(forEdit(await render()));
}

/** Like `replyPrivately`, for a one-line notice. */
export const noticePrivately = (
  interaction: RepliableInteraction,
  run: () => Promise<string>,
): Promise<void> => replyPrivately(interaction, async () => noticeView(await run()));
