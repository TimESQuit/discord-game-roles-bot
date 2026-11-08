import {
  ADMIN_CATEGORY_NAME,
  ADMIN_CHANNEL_NAME,
  BACKUPS_CHANNEL_NAME,
  LOG_CHANNEL_NAME,
  NEWS_CHANNEL_NAME,
  PANEL_CHANNEL_NAME,
  STARTING_CATEGORIES,
  TEMPLATE_ROLE_NAME,
  MESSAGES,
} from "../constants.ts";
import { hasTiedRolePositions, planSetup } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { panelView } from "../views/index.ts";

import type { PermissionsString } from "discord.js";
import type { SetupKey } from "../db/index.ts";
import type { Overwrite } from "../discord/index.ts";
import type { SetupItem } from "../domain/index.ts";
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

export const PERMISSION_NAMES = {
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

export const missingPermissionMessage = (name: string): string =>
  `Give the bot the ${name} permission.`;

/** The problems to fix before setup can run, each a full sentence. */
export async function checkSetup(ctx: AppContext): Promise<string[]> {
  // The gateway reports any PermissionsString, so look names up as optional.
  const names: Partial<Record<PermissionsString, string>> = PERMISSION_NAMES;
  const problems = ctx.gateway
    .missingBotPermissions(REQUIRED_PERMISSIONS)
    .map((p) => missingPermissionMessage(names[p] ?? p));
  const id = await ctx.repos.setup.get("templateRoleId");
  const template = id === undefined ? undefined : ctx.gateway.role(id);
  const botTop = ctx.gateway.botTopRolePosition();
  if (hasTiedRolePositions(ctx.gateway.roles(), botTop)) {
    problems.push(MESSAGES.rolePositionsTied);
  } else if (template && botTop <= template.position) {
    problems.push(MESSAGES.botRoleTooLow);
  }
  return problems;
}

async function planFor(ctx: AppContext, lookUpMessage: boolean) {
  const recorded = await ctx.repos.setup.all();
  const exists = (key: SetupKey): boolean => {
    const id = recorded[key];
    if (id === undefined) return false;
    return key === "templateRoleId"
      ? ctx.gateway.role(id) !== undefined
      : ctx.gateway.channelExists(id);
  };
  const channelId = recorded.panelChannelId;
  const messageId = recorded.panelMessageId;
  const panelMessageExists =
    lookUpMessage && channelId !== undefined && messageId !== undefined && exists("panelChannelId")
      ? await ctx.gateway.messageExists(channelId, messageId)
      : false;
  const categoryCount = (await ctx.repos.categories.list()).length;
  return planSetup({ recorded, exists, categoryCount, panelMessageExists });
}

export async function previewSetup(
  ctx: AppContext,
): Promise<{ problems: string[]; plan: ReturnType<typeof planSetup> }> {
  const problems = await checkSetup(ctx);
  // With problems the bot may not be able to read the panel message; it is shown as needing a repost.
  return { problems, plan: await planFor(ctx, problems.length === 0) };
}

/** Wraps `fn` so a call made while another is still running fails with `busyMessage`. */
export function exclusive<Args extends unknown[], R>(
  busyMessage: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  let running = false;
  return async (...args) => {
    if (running) throw new UserFacingError(busyMessage);
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
}

const list = (items: SetupItem[]): string => (items.length > 0 ? items.join(", ") : "none");

async function runSetup(
  ctx: AppContext,
  actorId: string,
): Promise<{ created: SetupItem[]; fine: SetupItem[] }> {
  const problems = await checkSetup(ctx);
  if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
  const plan = await planFor(ctx, true);

  const { gateway, repos } = ctx;
  const bot = gateway.botUserId;
  const readOnly: Overwrite[] = [
    {
      id: "everyone",
      allow: ["ViewChannel"],
      deny: ["SendMessages", "CreatePublicThreads", "AddReactions"],
    },
    { id: bot, allow: ["SendMessages", "EmbedLinks", "AttachFiles"], deny: [] },
  ];
  const adminOnly: Overwrite[] = [
    { id: "everyone", allow: [], deny: ["ViewChannel"] },
    { id: ctx.config.adminRoleId, allow: ["ViewChannel"], deny: [] },
    {
      id: bot,
      allow: ["ViewChannel", "SendMessages", "AttachFiles", "ReadMessageHistory"],
      deny: [],
    },
  ];
  const adminChannels: { item: SetupItem; key: SetupKey; name: string }[] = [
    { item: "adminChannel", key: "adminChannelId", name: ADMIN_CHANNEL_NAME },
    { item: "logChannel", key: "logChannelId", name: LOG_CHANNEL_NAME },
    { item: "backupsChannel", key: "backupsChannelId", name: BACKUPS_CHANNEL_NAME },
  ];
  const reason = `Setup by ${actorId}`;

  for (const item of plan.create) {
    switch (item) {
      case "templateRole": {
        const role = await gateway.createRole(
          { name: TEMPLATE_ROLE_NAME, color: 0, mentionable: true },
          reason,
        );
        await repos.setup.set("templateRoleId", role.id);
        break;
      }
      case "panelChannel":
        await repos.setup.set(
          "panelChannelId",
          await gateway.createTextChannel(PANEL_CHANNEL_NAME, null, readOnly),
        );
        break;
      case "newsChannel":
        await repos.setup.set(
          "newsChannelId",
          await gateway.createTextChannel(NEWS_CHANNEL_NAME, null, readOnly),
        );
        break;
      case "adminCategory": {
        const id = await gateway.createCategory(ADMIN_CATEGORY_NAME, adminOnly);
        // Admin channels that survived the old category move under the new one.
        for (const c of adminChannels) {
          if (plan.fine.includes(c.item)) {
            const channelId = await repos.setup.get(c.key);
            if (channelId !== undefined) await gateway.setChannelParent(channelId, id);
          }
        }
        // Recorded only after the moves, so a failed move is retried on the next run.
        await repos.setup.set("adminCategoryId", id);
        break;
      }
      case "adminChannel":
      case "logChannel":
      case "backupsChannel": {
        const c = adminChannels.find((x) => x.item === item);
        if (!c) throw new Error(`No admin channel is defined for ${item}`);
        const parent = await repos.setup.get("adminCategoryId");
        await repos.setup.set(
          c.key,
          await gateway.createTextChannel(c.name, parent ?? null, adminOnly),
        );
        break;
      }
      case "categories":
        for (const name of STARTING_CATEGORIES) await repos.categories.add(name);
        break;
      case "panelMessage": {
        const channelId = await repos.setup.get("panelChannelId");
        if (channelId === undefined) throw new Error("The panel channel was not recorded");
        await repos.setup.set("panelMessageId", await gateway.send(channelId, panelView()));
        break;
      }
    }
  }

  await ctx.audit.log({
    kind: "setup",
    userId: actorId,
    detail: `created: ${list(plan.create)}; already fine: ${list(plan.fine)}`,
  });
  return { created: plan.create, fine: plan.fine };
}

export const applySetup = exclusive("Setup is already running.", runSetup);

async function runRefresh(ctx: AppContext, actorId: string): Promise<"updated" | "reposted"> {
  const channelId = await ctx.repos.setup.get("panelChannelId");
  if (channelId === undefined || !ctx.gateway.channelExists(channelId))
    throw new UserFacingError(MESSAGES.setupFirst);
  const messageId = await ctx.repos.setup.get("panelMessageId");
  let result: "updated" | "reposted" = "reposted";
  if (messageId !== undefined && (await ctx.gateway.edit(channelId, messageId, panelView()))) {
    result = "updated";
  } else {
    await ctx.repos.setup.set("panelMessageId", await ctx.gateway.send(channelId, panelView()));
  }
  await ctx.audit.log({
    kind: "setup",
    userId: actorId,
    detail: `refreshed the panel (${result})`,
  });
  return result;
}

export const refreshPanel = exclusive("The panel is already being refreshed.", runRefresh);
