import type {
  BaseMessageOptions,
  MessageFlags,
  MessageMentionOptions,
  PermissionsString,
} from "discord.js";

export interface RoleSnapshot {
  id: string;
  name: string;
  position: number;
  color: number;
  mentionable: boolean;
}
export interface Overwrite {
  id: string;
  allow: PermissionsString[];
  deny: PermissionsString[];
}
/**
 * A message body that creates, edits and replies can all take. Flags are a list, so the
 * private (ephemeral) variants type-check against the reply options without a cast.
 */
export interface Payload {
  content?: string;
  components?: BaseMessageOptions["components"];
  allowedMentions?: MessageMentionOptions;
  files?: BaseMessageOptions["files"];
  flags?: readonly (
    | MessageFlags.IsComponentsV2
    | MessageFlags.Ephemeral
    | MessageFlags.SuppressNotifications
  )[];
}
export interface OwnMessage {
  id: string;
  createdAt: Date;
  hasAttachment: boolean;
}

export interface Gateway {
  readonly guildId: string;
  readonly botUserId: string;
  role(id: string): RoleSnapshot | undefined;
  roles(): RoleSnapshot[];
  createRole(
    o: { name: string; color: number; mentionable: boolean },
    reason: string,
  ): Promise<RoleSnapshot>;
  editRole(
    id: string,
    patch: Partial<Pick<RoleSnapshot, "name" | "color" | "mentionable">>,
    reason: string,
  ): Promise<void>;
  deleteRole(id: string, reason: string): Promise<void>;
  setRolePositions(
    changes: readonly { id: string; position: number }[],
    reason: string,
  ): Promise<void>;
  botTopRolePosition(): number;
  missingBotPermissions(required: readonly PermissionsString[]): PermissionsString[];
  /** Empty set if the member is not cached. */
  memberRoleIds(userId: string): ReadonlySet<string>;
  roleMemberIds(roleId: string): string[];
  addMemberRole(userId: string, roleId: string, reason: string): Promise<void>;
  removeMemberRole(userId: string, roleId: string, reason: string): Promise<void>;
  channelExists(id: string): boolean;
  createCategory(name: string, overwrites: readonly Overwrite[]): Promise<string>;
  createTextChannel(
    name: string,
    parentId: string | null,
    overwrites: readonly Overwrite[],
  ): Promise<string>;
  /** Deletes a channel or category. Deleting a category leaves its channels in place. */
  deleteChannel(id: string, reason: string): Promise<void>;
  /** Moves a channel under a category without copying the category's permissions. */
  setChannelParent(channelId: string, parentId: string): Promise<void>;
  /** False if the message or its channel is gone. */
  messageExists(channelId: string, messageId: string): Promise<boolean>;
  /** Resolves to the new message ID. */
  send(channelId: string, payload: Payload): Promise<string>;
  /** Resolves to false if the message is gone. */
  edit(channelId: string, messageId: string, payload: Payload): Promise<boolean>;
  ownMessages(channelId: string, limit: number): Promise<OwnMessage[]>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  /** Removes the bot's slash commands from the server. */
  clearCommands(): Promise<void>;
  /** The bot leaves the server for good; Discord also deletes the bot's own role. */
  leave(): Promise<void>;
}
