import { MESSAGES } from "../constants.ts";
import { hasTiedRolePositions } from "../domain/index.ts";

import type { PermissionsString } from "discord.js";
import type { RoleSnapshot } from "../discord/index.ts";
import type { AppContext } from "./context.ts";

export const REQUIRED_PERMISSIONS = [
  "ManageRoles",
  "ManageChannels",
  "ViewChannel",
  "SendMessages",
  "EmbedLinks",
  "AttachFiles",
  "ReadMessageHistory",
  "CreatePublicThreads",
  "AddReactions",
] as const satisfies readonly PermissionsString[];

type RequiredPermission = (typeof REQUIRED_PERMISSIONS)[number];

const PERMISSION_NAMES = {
  ManageRoles: "Manage Roles",
  ManageChannels: "Manage Channels",
  ViewChannel: "View Channels",
  SendMessages: "Send Messages",
  EmbedLinks: "Embed Links",
  AttachFiles: "Attach Files",
  ReadMessageHistory: "Read Message History",
  CreatePublicThreads: "Create Public Threads",
  AddReactions: "Add Reactions",
} as const satisfies Record<RequiredPermission, string>;

/** The fix for each of `required` the bot lacks, as full sentences. */
export function missingPermissionProblems(
  ctx: AppContext,
  required: readonly RequiredPermission[],
): string[] {
  // The gateway reports any PermissionsString, so look names up as optional.
  const names: Partial<Record<PermissionsString, string>> = PERMISSION_NAMES;
  return ctx.gateway
    .missingBotPermissions(required)
    .map((p) => `Give the bot the ${names[p] ?? p} permission.`);
}

/** The template role, if it is recorded and still exists. */
export async function templateRole(ctx: AppContext): Promise<RoleSnapshot | undefined> {
  const id = await ctx.repos.setup.get("templateRoleId");
  return id === undefined ? undefined : ctx.gateway.role(id);
}

/** Why the bot can't move game roles below its own, or null when it can. */
export function roleOrderProblem(
  ctx: AppContext,
  template: RoleSnapshot | undefined,
): string | null {
  const botTop = ctx.gateway.botTopRolePosition();
  if (hasTiedRolePositions(ctx.gateway.roles(), botTop)) return MESSAGES.rolePositionsTied;
  if (template && botTop <= template.position) return MESSAGES.botRoleTooLow;
  return null;
}
