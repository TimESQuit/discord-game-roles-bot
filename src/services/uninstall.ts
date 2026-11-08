import { clearData } from "../db/index.ts";
import { deletesHere, text } from "../domain/index.ts";
import { messageOf, UserFacingError } from "../errors.ts";
import { snapshotDatabase } from "./backup.ts";
import { exclusive } from "./setup.ts";

import type { SetupKey } from "../db/index.ts";
import type {
  ChannelGroup,
  UninstallChoices,
  UninstallResult,
  UninstallSummary,
} from "../domain/index.ts";
import type { AppContext } from "./context.ts";

const MEMBER_CHANNELS = ["panelChannelId", "newsChannelId"] as const satisfies SetupKey[];
/** The category comes last, so its channels are gone before it is. */
const ADMIN_CHANNELS = [
  "adminChannelId",
  "logChannelId",
  "backupsChannelId",
  "adminCategoryId",
] as const satisfies SetupKey[];

async function existingChannels(
  ctx: AppContext,
  keys: readonly SetupKey[],
): Promise<{ key: SetupKey; id: string }[]> {
  const recorded = await ctx.repos.setup.all();
  return keys.flatMap((key) => {
    const id = recorded[key];
    return id !== undefined && ctx.gateway.channelExists(id) ? [{ key, id }] : [];
  });
}

async function groupOf(ctx: AppContext, channelId: string | null): Promise<ChannelGroup | null> {
  if (channelId === null) return null;
  const recorded = await ctx.repos.setup.all();
  if (MEMBER_CHANNELS.some((key) => recorded[key] === channelId)) return "member";
  if (ADMIN_CHANNELS.some((key) => recorded[key] === channelId)) return "admin";
  return null;
}

/** What uninstalling would touch, for the choices screen. */
export async function previewUninstall(
  ctx: AppContext,
  fromChannelId: string | null,
): Promise<UninstallSummary> {
  const roles = (await ctx.repos.games.list())
    .map((g) => g.roleId)
    .filter((id) => ctx.gateway.role(id) !== undefined);
  const members = new Set(roles.flatMap((id) => ctx.gateway.roleMemberIds(id)));
  const admin = await existingChannels(ctx, ADMIN_CHANNELS);
  return {
    gameRoles: roles.length,
    members: members.size,
    memberChannels: (await existingChannels(ctx, MEMBER_CHANNELS)).length,
    adminChannels: admin.filter((c) => c.key !== "adminCategoryId").length,
    here: await groupOf(ctx, fromChannelId),
  };
}

/** Runs one deletion, turning a Discord failure into a message that says how to finish. */
async function step(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    throw new UserFacingError(
      `Uninstall stopped while deleting ${what}: ${messageOf(error)}. The bot's data is untouched; fix that and run /gameadmin uninstall again to finish.`,
    );
  }
}

async function runUninstall(
  ctx: AppContext,
  actorId: string,
  choices: UninstallChoices,
  fromChannelId: string | null,
): Promise<UninstallResult> {
  if (deletesHere(await groupOf(ctx, fromChannelId), choices)) {
    throw new UserFacingError(
      "Run this from a channel you're keeping, so the report and backup can reach you.",
    );
  }

  const { gateway, repos } = ctx;
  const reason = `Uninstall by ${actorId}`;
  let deletedRoles = 0;
  let deletedChannels = 0;

  if (!choices.has("keepRoles")) {
    const roles = (await repos.games.list()).map((g) => ({
      id: g.roleId,
      what: `the ${g.name} role`,
    }));
    const template = await repos.setup.get("templateRoleId");
    if (template !== undefined) roles.push({ id: template, what: "the template role" });
    for (const role of roles) {
      if (gateway.role(role.id) === undefined) continue;
      await step(text(role.what), () => gateway.deleteRole(role.id, reason));
      deletedRoles += 1;
    }
  }

  const deleteChannels = async (keys: readonly SetupKey[]): Promise<void> => {
    for (const { id } of await existingChannels(ctx, keys)) {
      await step(`<#${id}>`, () => gateway.deleteChannel(id, reason));
      deletedChannels += 1;
    }
  };

  if (choices.has("keepMemberChannels")) {
    // The panel's buttons stop working once the data is gone, so the message goes.
    const panel = await repos.setup.get("panelChannelId");
    const message = await repos.setup.get("panelMessageId");
    if (
      panel !== undefined &&
      message !== undefined &&
      gateway.channelExists(panel) &&
      (await gateway.messageExists(panel, message))
    ) {
      await step("the panel message", () => gateway.deleteMessage(panel, message));
    }
  } else {
    await deleteChannels(MEMBER_CHANNELS);
  }
  if (!choices.has("keepAdminChannels")) await deleteChannels(ADMIN_CHANNELS);

  const backup = await snapshotDatabase(ctx.db, ctx.now());
  // Logged while the log channel is still recorded; only when it survives.
  if (choices.has("keepAdminChannels")) {
    await ctx.audit.log({
      kind: "uninstalled",
      userId: actorId,
      detail: `deleted ${String(deletedRoles)} roles and ${String(deletedChannels)} channels`,
    });
  }
  clearData(ctx.db);
  return { deletedRoles, deletedChannels, backup };
}

export const applyUninstall = exclusive("Uninstall is already running.", runUninstall);

/** Removes the slash commands, then leaves. The last thing the bot does in the server. */
export async function leaveServer(ctx: AppContext): Promise<void> {
  await ctx.gateway.clearCommands();
  await ctx.gateway.leave();
}
