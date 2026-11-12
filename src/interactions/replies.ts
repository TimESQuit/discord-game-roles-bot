import { MessageFlags } from "discord.js";

import { DISCORD_ERROR, isDiscordError } from "../discord/index.ts";
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
import type { PrivateView } from "../views/index.ts";
import type { Close } from "./menus.ts";

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

type Answer = Pick<RepliableInteraction, "user" | "createdTimestamp" | "webhook">;

/** Deletes the interaction's own message (its original response) through its webhook alone. */
function closeOriginal(interaction: Pick<RepliableInteraction, "webhook">): Close {
  const { webhook } = interaction;
  return () => webhook.deleteMessage("@original");
}

/**
 * After `view` is shown in `message` (the interaction's original response): a notice closes
 * itself soon; a view carrying files stays and is never tracked, so nothing deletes it with its
 * attachment; any other private view becomes the person's open menu, closing the one before.
 * `since` is the menu ticket from before the work began (see `openMenus.open`).
 * Public messages are never tracked, so the bot never deletes one this way.
 */
function settle(
  interaction: Answer,
  message: Pick<Message, "id" | "flags"> | null | undefined,
  view: PrivateView,
  since: number,
): void {
  if (!message?.flags.has(MessageFlags.Ephemeral)) return;
  const userId = interaction.user.id;
  if (view.notice || (view.files?.length ?? 0) > 0) {
    openMenus.forget(userId, message.id);
    if (view.notice) closeSoon(closeOriginal(interaction));
    return;
  }
  openMenus.open(
    userId,
    {
      messageId: message.id,
      close: closeOriginal(interaction),
      expiresAt: interaction.createdTimestamp + TOKEN_LIFETIME_MS,
    },
    since,
  );
}

/** Acknowledges a component (or a modal opened from one), then replaces its message with the view `render` builds. */
export async function updateWith(
  interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction,
  render: () => Promise<PrivateView>,
): Promise<void> {
  const since = openMenus.ticket();
  await interaction.deferUpdate();
  const view = await render();
  try {
    await interaction.editReply(forEdit(view));
  } catch (error) {
    // A newer menu closed this one while `render` ran, or the person dismissed it.
    if (isDiscordError(error, DISCORD_ERROR.unknownMessage)) return;
    throw error;
  }
  settle(interaction, interaction.message, view, since);
}

/**
 * Acknowledges a component whose message will carry a file. The message stops being the
 * person's open menu at once, so a menu opened during the slow work that follows can't delete it.
 */
export async function deferAndKeep(interaction: MessageComponentInteraction): Promise<void> {
  await interaction.deferUpdate();
  openMenus.forget(interaction.user.id, interaction.message.id);
}

/** Defers a private reply, then fills it with the view `render` builds. */
export async function replyPrivately(
  interaction: RepliableInteraction,
  render: () => Promise<PrivateView>,
): Promise<void> {
  const since = openMenus.ticket();
  await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
  const view = await render();
  settle(interaction, await interaction.editReply(forEdit(view)), view, since);
}

/** Replies at once with a private view that is already built. */
export async function showPrivately(
  interaction: RepliableInteraction,
  view: PrivateView,
): Promise<void> {
  const since = openMenus.ticket();
  const response = await interaction.reply({ ...forReply(view), withResponse: true });
  settle(interaction, response.resource?.message, view, since);
}

/** Like `replyPrivately`, for a one-line notice. */
export const noticePrivately = (
  interaction: RepliableInteraction,
  run: () => Promise<string>,
): Promise<void> => replyPrivately(interaction, async () => noticeView(await run()));

/**
 * Sends `view` privately as the reply, or as a follow-up once the interaction was answered.
 * A notice closes itself; anything else, such as an error, stays. It never becomes the open menu.
 */
export async function sayPrivately(
  interaction: RepliableInteraction,
  view: PrivateView,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    const message = await interaction.followUp(forReply(view));
    const { webhook } = interaction;
    if (view.notice) closeSoon(() => webhook.deleteMessage(message.id));
  } else {
    await interaction.reply(forReply(view));
    if (view.notice) closeSoon(closeOriginal(interaction));
  }
}
