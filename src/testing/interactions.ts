import {
  ButtonInteraction,
  ComponentType,
  InteractionType,
  MessageFlags,
  MessageFlagsBitField,
  SnowflakeUtil,
} from "discord.js";

import { textOf } from "./payloads.ts";

import type { InteractionEditReplyOptions, MessageResolvable } from "discord.js";

export const FAKE_USER_ID = "100000000000000001";

const PRIVATE = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

const fakeMessage = (id: string, flags: number) => ({ id, flags: new MessageFlagsBitField(flags) });

/**
 * A real ButtonInteraction prototype, so discord.js's own isButton() runs, with its calls
 * recorded in `log`. It sits on the message `onMessage` (private unless `ephemeral` is false);
 * a reply it sends becomes the message `replyId`. Deleting logs `deleteReply:<message ID>`.
 */
export function fakeButton(
  log: string[],
  {
    customId = "",
    onMessage = "menu-1",
    ephemeral = true,
    replyId = "reply-1",
    channelId = "100000000000009999",
    roles = [],
  }: {
    customId?: string;
    onMessage?: string;
    ephemeral?: boolean;
    replyId?: string;
    channelId?: string;
    roles?: string[];
  } = {},
): ButtonInteraction {
  const made: unknown = Object.create(ButtonInteraction.prototype);
  if (!(made instanceof ButtonInteraction)) throw new Error("Could not build a fake interaction");
  // A getter on the prototype that reads the client's cache; the fake has no cached channel.
  Object.defineProperty(made, "channel", { value: null });
  // A deferred update answers on the button's own message; a new reply is its own message.
  let original = onMessage;
  return Object.assign(made, {
    type: InteractionType.MessageComponent,
    componentType: ComponentType.Button,
    id: SnowflakeUtil.generate({ timestamp: Date.now() }).toString(),
    customId,
    channelId,
    user: { id: FAKE_USER_ID },
    member: { roles },
    message: fakeMessage(onMessage, ephemeral ? PRIVATE : MessageFlags.IsComponentsV2),
    deferUpdate: async () => void log.push("deferUpdate"),
    deferReply: async () => {
      original = replyId;
      log.push("deferReply");
    },
    editReply: async (options: InteractionEditReplyOptions) => {
      log.push(`editReply:${textOf(options.components ?? [])}`);
      return fakeMessage(original, PRIVATE);
    },
    reply: async () => {
      original = replyId;
      log.push("reply");
      return { resource: { message: fakeMessage(replyId, PRIVATE) } };
    },
    followUp: async () => {
      log.push("followUp");
      return fakeMessage("follow-up-1", PRIVATE);
    },
    deleteReply: async (message: MessageResolvable = "@original") => {
      const id =
        message === "@original" ? original : typeof message === "string" ? message : message.id;
      log.push(`deleteReply:${id}`);
    },
  });
}

/** The IDs of the messages a fake interaction deleted, in order. */
export const deletedIds = (log: readonly string[]): string[] =>
  log.flatMap((line) =>
    line.startsWith("deleteReply:") ? [line.slice("deleteReply:".length)] : [],
  );
