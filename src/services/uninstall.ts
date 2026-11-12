import { MESSAGES } from "../constants.ts";
import { clearData } from "../db/index.ts";
import { deletesHere, text } from "../domain/index.ts";
import { messageOf, UserFacingError } from "../errors.ts";
import { snapshotDatabase } from "./backup.ts";
import { exclusive } from "./concurrency.ts";
import { liveGameRoleIds } from "./games.ts";

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

type Recorded = Awaited<ReturnType<AppContext["repos"]["setup"]["all"]>>;

function existingChannels(
  ctx: AppContext,
  recorded: Recorded,
  keys: readonly SetupKey[],
): { key: SetupKey; id: string }[] {
  return keys.flatMap((key) => {
    const id = recorded[key];
    return id !== undefined && ctx.gateway.channelExists(id) ? [{ key, id }] : [];
  });
}

function groupOf(recorded: Recorded, channelId: string | null): ChannelGroup | null {
  if (channelId === null) return null;
  if (MEMBER_CHANNELS.some((key) => recorded[key] === channelId)) return "member";
  if (ADMIN_CHANNELS.some((key) => recorded[key] === channelId)) return "admin";
  return null;
}

/** What uninstalling would touch, for the choices screen. */
export async function previewUninstall(
  ctx: AppContext,
  fromChannelId: string | null,
): Promise<UninstallSummary> {
  const roles = await liveGameRoleIds(ctx);
  const members = new Set(roles.flatMap((id) => ctx.gateway.roleMemberIds(id)));
  const recorded = await ctx.repos.setup.all();
  const admin = existingChannels(ctx, recorded, ADMIN_CHANNELS);
  return {
    gameRoles: roles.length,
    members: members.size,
    memberChannels: existingChannels(ctx, recorded, MEMBER_CHANNELS).length,
    adminChannels: admin.filter((c) => c.key !== "adminCategoryId").length,
    here: groupOf(recorded, fromChannelId),
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
  /** Sends the report and backup to the admin. The data is wiped only once this succeeds. */
  deliver: (result: UninstallResult) => Promise<void>,
): Promise<UninstallResult> {
  // Nothing below changes the setup table until the wipe, so one read serves the whole run.
  const recorded = await ctx.repos.setup.all();
  if (deletesHere(groupOf(recorded, fromChannelId), choices)) {
    throw new UserFacingError(MESSAGES.uninstallFromKeptChannel);
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
    const template = recorded.templateRoleId;
    if (template !== undefined) roles.push({ id: template, what: "the template role" });
    for (const role of roles) {
      if (gateway.role(role.id) === undefined) continue;
      await step(text(role.what), () => gateway.deleteRole(role.id, reason));
      deletedRoles += 1;
    }
  }

  const deleteChannels = async (keys: readonly SetupKey[]): Promise<void> => {
    for (const { id } of existingChannels(ctx, recorded, keys)) {
      await step(`<#${id}>`, () => gateway.deleteChannel(id, reason));
      deletedChannels += 1;
    }
  };

  if (choices.has("keepMemberChannels")) {
    // The panel's buttons stop working once the data is gone, so the message goes.
    const { panelChannelId: panel, panelMessageId: message } = recorded;
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
  const result = { deletedRoles, deletedChannels, backup };
  // The backup is the only copy of the data, so it must reach the admin before the wipe. If
  // delivery fails, the data stays and running uninstall again finishes the job.
  try {
    await deliver(result);
  } catch (error) {
    throw new UserFacingError(
      `Uninstall couldn't send you the report and backup: ${messageOf(error)}. The bot's data is untouched; run /gameadmin uninstall again to finish.`,
    );
  }
  clearData(ctx.db);
  return result;
}

export const applyUninstall = exclusive("Uninstall is already running.", runUninstall);

/** Removes the slash commands, then leaves. The last thing the bot does in the server. */
export async function leaveServer(ctx: AppContext): Promise<void> {
  await ctx.gateway.clearCommands();
  await ctx.gateway.leave();
}
