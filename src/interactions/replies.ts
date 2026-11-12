import { MessageFlags } from "discord.js";

import { noticeView } from "../views/index.ts";
import { TOKEN_LIFETIME_MS, closeSoon, openMenus } from "./menus.ts";

import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  Message,
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
  files: view.files,
});

export const forReply = (view: Payload): InteractionReplyOptions => ({
  components: view.components,
  flags: view.flags,
  allowedMentions: view.allowedMentions,
});

/**
 * After `view` is shown in `message` (the interaction's original response): a notice closes
 * itself soon, and a private menu becomes the person's open menu, closing the one before.
 * Public messages are never tracked, so the bot never deletes one this way.
 */
async function track(
  interaction: Pick<RepliableInteraction, "user" | "createdTimestamp" | "deleteReply">,
  message: Pick<Message, "id" | "flags"> | null | undefined,
  view: Payload,
): Promise<void> {
  if (!message?.flags.has(MessageFlags.Ephemeral)) return;
  const userId = interaction.user.id;
  if (view.notice) {
    openMenus.forget(userId, message.id);
    closeSoon(() => interaction.deleteReply());
    return;
  }
  await openMenus.open(userId, {
    messageId: message.id,
    close: () => interaction.deleteReply(),
    expiresAt: interaction.createdTimestamp + TOKEN_LIFETIME_MS,
  });
}

/** Acknowledges a component (or a modal opened from one), then replaces its message with the view `render` builds. */
export async function updateWith(
  interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction,
  render: () => Promise<Payload>,
): Promise<void> {
  await interaction.deferUpdate();
  const view = await render();
  await interaction.editReply(forEdit(view));
  await track(interaction, interaction.message, view);
}

/** Defers a private reply, then fills it with the view `render` builds. */
export async function replyPrivately(
  interaction: RepliableInteraction,
  render: () => Promise<Payload>,
): Promise<void> {
  await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
  const view = await render();
  await track(interaction, await interaction.editReply(forEdit(view)), view);
}

/** Replies at once with a private view that is already built. */
export async function showPrivately(
  interaction: RepliableInteraction,
  view: Payload,
): Promise<void> {
  const response = await interaction.reply({ ...forReply(view), withResponse: true });
  await track(interaction, response.resource?.message, view);
}

/** Like `replyPrivately`, for a one-line notice. */
export const noticePrivately = (
  interaction: RepliableInteraction,
  run: () => Promise<string>,
): Promise<void> => replyPrivately(interaction, async () => noticeView(await run()));

/** A one-line notice sent after the interaction was already answered; it closes itself too. */
export async function followUpNotice(
  interaction: RepliableInteraction,
  content: string,
): Promise<void> {
  const message = await interaction.followUp(forReply(noticeView(content)));
  closeSoon(() => interaction.deleteReply(message));
}
