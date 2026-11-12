import { ChannelType, MessageFlags, PermissionsBitField } from "discord.js";

import { DISCORD_ERROR, isDiscordError } from "./discord-errors.ts";

import type { Client, Guild, OverwriteResolvable, PermissionsString, Role } from "discord.js";
import type { Gateway, Overwrite, OwnMessage, Payload, RoleSnapshot } from "./gateway.ts";

function snapshot(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    position: role.position,
    color: role.colors.primaryColor,
    mentionable: role.mentionable,
  };
}

type PayloadFlag = NonNullable<Payload["flags"]>[number];

/** The ephemeral flag only exists on interaction replies. */
const isSendFlag = (
  flag: PayloadFlag,
): flag is MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications =>
  flag !== MessageFlags.Ephemeral;

/** Notifications are decided when a message is sent, so an edit keeps only the layout flag. */
const isEditFlag = (flag: PayloadFlag): flag is MessageFlags.IsComponentsV2 =>
  flag === MessageFlags.IsComponentsV2;

/**
 * The part of a payload a channel message can carry. Create and edit options share these
 * fields; edit rejects only fields such as reply/stickers that the bot never sets on these
 * posts.
 */
function channelBody(payload: Payload) {
  return {
    content: payload.content,
    components: payload.components,
    allowedMentions: payload.allowedMentions,
    files: payload.files,
  };
}

export function createDiscordGateway(client: Client<true>, guildId: string): Gateway {
  const guild = (): Guild => {
    const g = client.guilds.cache.get(guildId);
    if (!g) throw new Error(`Guild ${guildId} is not available`);
    return g;
  };
  const requireRole = (id: string): Role => {
    const r = guild().roles.cache.get(id);
    if (!r) throw new Error(`Unknown role ${id}`);
    return r;
  };
  const textChannel = async (id: string) => {
    const ch = guild().channels.cache.get(id) ?? (await client.channels.fetch(id));
    if (!ch || !ch.isTextBased()) throw new Error(`Channel ${id} is not a text channel`);
    return ch;
  };
  const resolveOverwrites = (list: readonly Overwrite[]): OverwriteResolvable[] =>
    list.map((o) => ({
      id: o.id === "everyone" ? guild().id : o.id,
      allow: o.allow,
      deny: o.deny,
    }));

  return {
    guildId,
    botUserId: client.user.id,

    role: (id) => {
      const r = guild().roles.cache.get(id);
      return r ? snapshot(r) : undefined;
    },
    roles: () => [...guild().roles.cache.values()].map(snapshot),
    async createRole(o, reason) {
      const role = await guild().roles.create({
        name: o.name,
        colors: { primaryColor: o.color },
        mentionable: o.mentionable,
        permissions: [],
        reason,
      });
      return snapshot(role);
    },
    async editRole(id, { color, ...patch }, reason) {
      const colors = color === undefined ? {} : { colors: { primaryColor: color } };
      await requireRole(id).edit({ ...patch, ...colors, reason });
    },
    async deleteRole(id, reason) {
      await requireRole(id).delete(reason);
    },
    async setRolePositions(changes) {
      // discord.js 14.28.1 setPositions has no audit-log reason parameter.
      await guild().roles.setPositions(changes.map((c) => ({ role: c.id, position: c.position })));
    },
    botTopRolePosition: () => guild().members.me?.roles.highest.position ?? 0,
    missingBotPermissions(required) {
      const perms = guild().members.me?.permissions ?? new PermissionsBitField();
      return required.filter((p): p is PermissionsString => !perms.has(p));
    },
    memberRoleIds(userId) {
      const m = guild().members.cache.get(userId);
      return new Set(m ? m.roles.cache.keys() : []);
    },
    async fetchMemberRoleIds(userId) {
      const m = await guild().members.fetch({ user: userId, force: true });
      return new Set(m.roles.cache.keys());
    },
    roleMemberIds: (roleId) => [...(guild().roles.cache.get(roleId)?.members.keys() ?? [])],
    async addMemberRole(userId, roleId, reason) {
      await (await guild().members.fetch(userId)).roles.add(roleId, reason);
    },
    async removeMemberRole(userId, roleId, reason) {
      await (await guild().members.fetch(userId)).roles.remove(roleId, reason);
    },
    channelExists: (id) => guild().channels.cache.has(id),
    async createCategory(name, overwrites) {
      const ch = await guild().channels.create({
        name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: resolveOverwrites(overwrites),
      });
      return ch.id;
    },
    async createTextChannel(name, parentId, overwrites) {
      const ch = await guild().channels.create({
        name,
        type: ChannelType.GuildText,
        parent: parentId,
        permissionOverwrites: resolveOverwrites(overwrites),
      });
      return ch.id;
    },
    async deleteChannel(id, reason) {
      await guild().channels.delete(id, reason);
    },
    async setChannelParent(channelId, parentId) {
      const ch = guild().channels.cache.get(channelId) ?? (await client.channels.fetch(channelId));
      if (!ch || !("setParent" in ch)) throw new Error(`Channel ${channelId} cannot be moved`);
      await ch.setParent(parentId, { lockPermissions: false });
    },
    async messageExists(channelId, messageId) {
      try {
        const ch = await textChannel(channelId);
        await ch.messages.fetch(messageId);
        return true;
      } catch (error) {
        if (isDiscordError(error, DISCORD_ERROR.unknownMessage, DISCORD_ERROR.unknownChannel)) {
          return false;
        }
        throw error;
      }
    },
    async send(channelId, payload: Payload) {
      const ch = await textChannel(channelId);
      if (!ch.isSendable()) throw new Error(`Channel ${channelId} is not sendable`);
      return (await ch.send({ ...channelBody(payload), flags: payload.flags?.filter(isSendFlag) }))
        .id;
    },
    async edit(channelId, messageId, payload: Payload) {
      const ch = await textChannel(channelId);
      try {
        await ch.messages.edit(messageId, {
          ...channelBody(payload),
          flags: payload.flags?.filter(isEditFlag),
        });
        return true;
      } catch (error) {
        if (isDiscordError(error, DISCORD_ERROR.unknownMessage)) return false;
        throw error;
      }
    },
    async ownMessages(channelId, limit): Promise<OwnMessage[]> {
      const ch = await textChannel(channelId);
      const fetched = await ch.messages.fetch({ limit });
      return [...fetched.values()]
        .filter((m) => m.author.id === client.user.id)
        .toSorted((a, b) => b.createdTimestamp - a.createdTimestamp)
        .map((m) => ({
          id: m.id,
          createdAt: m.createdAt,
          hasAttachment: m.attachments.size > 0,
        }));
    },
    async deleteMessage(channelId, messageId) {
      const ch = await textChannel(channelId);
      await ch.messages.delete(messageId);
    },
    async clearCommands() {
      await client.application.commands.set([], guildId);
    },
    async leave() {
      await guild().leave();
    },
  };
}
