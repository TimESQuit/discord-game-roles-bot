import type { PermissionsString } from "discord.js";
import {
  ADMIN_CATEGORY_NAME,
  ADMIN_CHANNEL_NAME,
  BACKUPS_CHANNEL_NAME,
  LOG_CHANNEL_NAME,
  NEWS_CHANNEL_NAME,
  PANEL_CHANNEL_NAME,
  STARTING_CATEGORIES,
  TEMPLATE_ROLE_NAME,
} from "../constants.ts";
import type { SetupKey } from "../db/types.ts";
import type { Overwrite } from "../discord/gateway.ts";
import { planSetup, type SetupItem } from "../domain/setup-plan.ts";
import { UserFacingError } from "../errors.ts";
import { panelView } from "../views/member.ts";
import type { AppContext } from "./context.ts";

export const REQUIRED_PERMISSIONS: PermissionsString[] = [
  "ManageRoles",
  "ManageChannels",
  "ViewChannel",
  "SendMessages",
  "EmbedLinks",
  "AttachFiles",
  "ReadMessageHistory",
];

const PERMISSION_NAMES: Partial<Record<PermissionsString, string>> = {
  ManageRoles: "Manage Roles",
  ManageChannels: "Manage Channels",
  ViewChannel: "View Channels",
  SendMessages: "Send Messages",
  EmbedLinks: "Embed Links",
  AttachFiles: "Attach Files",
  ReadMessageHistory: "Read Message History",
};

/** The problems to fix before setup can run, each a full sentence. */
export async function checkSetup(ctx: AppContext): Promise<string[]> {
  const problems = ctx.gateway
    .missingBotPermissions(REQUIRED_PERMISSIONS)
    .map((p) => `Give the bot the ${PERMISSION_NAMES[p] ?? p} permission.`);
  const id = await ctx.repos.setup.get("templateRoleId");
  const template = id === undefined ? undefined : ctx.gateway.role(id);
  if (template && ctx.gateway.botTopRolePosition() <= template.position) {
    problems.push("Move the bot's role above Game role template in Server Settings → Roles");
  }
  return problems;
}

async function planFor(ctx: AppContext) {
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
    channelId !== undefined && messageId !== undefined && exists("panelChannelId")
      ? await ctx.gateway.messageExists(channelId, messageId)
      : false;
  const categoryCount = (await ctx.repos.categories.list()).length;
  return planSetup({ recorded, exists, categoryCount, panelMessageExists });
}

export async function previewSetup(
  ctx: AppContext,
): Promise<{ problems: string[]; plan: ReturnType<typeof planSetup> }> {
  return {
    problems: await checkSetup(ctx),
    plan: await planFor(ctx),
  };
}

export async function applySetup(
  ctx: AppContext,
  actorId: string,
): Promise<{ created: SetupItem[]; fine: SetupItem[] }> {
  const { problems, plan } = await previewSetup(ctx);
  if (problems.length > 0) throw new UserFacingError(problems.join("\n"));

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
        await repos.setup.set("adminCategoryId", id);
        // Admin channels that survived the old category move under the new one.
        for (const c of adminChannels) {
          if (plan.fine.includes(c.item)) {
            const channelId = await repos.setup.get(c.key);
            if (channelId !== undefined) await gateway.setChannelParent(channelId, id);
          }
        }
        break;
      }
      case "adminChannel":
      case "logChannel":
      case "backupsChannel": {
        const c = adminChannels.find((x) => x.item === item)!;
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
        const channelId = (await repos.setup.get("panelChannelId"))!;
        await repos.setup.set("panelMessageId", await gateway.send(channelId, panelView()));
        break;
      }
    }
  }

  const list = (items: SetupItem[]): string => (items.length > 0 ? items.join(", ") : "none");
  await ctx.audit.log({
    kind: "setup",
    userId: actorId,
    detail: `created: ${list(plan.create)}; already fine: ${list(plan.fine)}`,
  });
  return { created: plan.create, fine: plan.fine };
}

export async function refreshPanel(ctx: AppContext): Promise<"updated" | "reposted"> {
  const channelId = await ctx.repos.setup.get("panelChannelId");
  if (channelId === undefined) throw new UserFacingError("Run /gameadmin setup first.");
  const messageId = await ctx.repos.setup.get("panelMessageId");
  if (messageId !== undefined && (await ctx.gateway.edit(channelId, messageId, panelView()))) {
    return "updated";
  }
  await ctx.repos.setup.set("panelMessageId", await ctx.gateway.send(channelId, panelView()));
  return "reposted";
}
