import { MessageFlags, type Interaction } from "discord.js";
import { isAdmin } from "../domain/roles.ts";
import { UserFacingError } from "../errors.ts";
import type { AppContext } from "../services/context.ts";
import { isAdminId, parseId, type CustomId } from "./custom-ids.ts";

export const HANDLER_NAMES = [
  "panel-open",
  "add-select",
  "add-page",
  "remove-select",
  "suggest-modal",
  "dup-submit",
  "dup-join",
  "withdraw",
  "lfg-modal",
  "lfg-in",
  "lfg-maybe",
  "lfg-join",
  "cancel",
  "review-approve",
  "review-edit",
  "review-reject",
  "review-edit-modal",
  "review-reject-modal",
  "game-add-modal",
  "game-edit-modal",
  "confirm-remove",
  "confirm-setup",
  "category-add-modal",
  "category-rename-modal",
  "category-move",
  "category-add",
  "category-rename",
  "menu-add",
  "menu-remove",
  "menu-suggest",
  "menu-mine",
  "menu-who",
  "menu-mysug",
  "menu-lfg",
  "admin-review",
  "admin-add",
  "admin-edit",
  "admin-remove",
  "admin-categories",
  "admin-reapply",
  "admin-refresh",
  "admin-backup",
  "admin-setup",
  "pick-who",
  "pick-lfg",
  "pick-edit",
  "pick-remove",
  "games-menu",
  "games-add",
  "games-remove",
  "games-suggest",
  "games-mine",
  "games-who",
  "games-suggestions",
  "lfg",
  "gameadmin-setup",
  "gameadmin-backup",
  "gameadmin-review",
  "gameadmin-add",
  "gameadmin-edit",
  "gameadmin-remove",
  "gameadmin-reapply-template",
  "gameadmin-refresh-panel",
  "gameadmin-category-add",
  "gameadmin-category-rename",
  "gameadmin-category-move",
  "autocomplete-games",
  "autocomplete-lfg",
  "autocomplete-gameadmin",
  "ctx-see-games",
  "ctx-in-common",
] as const;

export type HandlerName = (typeof HANDLER_NAMES)[number];

// oxlint-disable-next-line typescript/no-explicit-any -- each handler narrows the interaction itself
export type Handlers = Partial<
  Record<HandlerName, (ctx: AppContext, interaction: any) => Promise<void>>
>;

export type RouteInput = {
  type: "button" | "select" | "modal" | "command" | "autocomplete" | "user-context";
  customId?: string;
  command?: string;
  subcommandGroup?: string | null;
  subcommand?: string | null;
  memberRoleIds: ReadonlySet<string>;
};

export type RouteResult = { handler: HandlerName } | { denied: true } | { unknown: true };

const HANDLER_SET: ReadonlySet<string> = new Set(HANDLER_NAMES);
const isHandlerName = (value: string): value is HandlerName => HANDLER_SET.has(value);

const CONTEXT_MENUS: Record<string, HandlerName> = {
  "See their games": "ctx-see-games",
  "Games in common": "ctx-in-common",
};

function idHandlerName(id: CustomId): string {
  switch (id.kind) {
    case "menu":
    case "admin":
      return `${id.kind}-${id.action}`;
    case "pick":
      return `pick-${id.purpose}`;
    default:
      return id.kind;
  }
}

function commandHandlerName(input: RouteInput): string | null {
  const { command, subcommand, subcommandGroup } = input;
  if (command === undefined) return null;
  if (input.type === "autocomplete") return `autocomplete-${command}`;
  if (command === "lfg") return "lfg";
  if (subcommand === undefined || subcommand === null) return null;
  if (command === "gameadmin" && subcommandGroup) {
    return `gameadmin-${subcommandGroup}-${subcommand}`;
  }
  return `${command}-${subcommand}`;
}

export function route(input: RouteInput, adminRoleId: string): RouteResult {
  const admin = isAdmin(input.memberRoleIds, adminRoleId);
  let name: string | null;
  let adminOnly = false;

  if (input.type === "user-context") {
    name = CONTEXT_MENUS[input.command ?? ""] ?? null;
  } else if (input.type === "command" || input.type === "autocomplete") {
    name = commandHandlerName(input);
    adminOnly = input.command === "gameadmin";
  } else {
    const id = input.customId === undefined ? null : parseId(input.customId);
    if (id === null) return { unknown: true };
    name = idHandlerName(id);
    adminOnly = isAdminId(id);
  }

  if (adminOnly && !admin) return { denied: true };
  if (name === null || !isHandlerName(name)) return { unknown: true };
  return { handler: name };
}

const PRIVATE = MessageFlags.Ephemeral as const;
const GENERIC_ERROR = "Something went wrong. The admins have been told.";
const EXPIRED = "That button has expired. Open the menu again.";

function routeInput(
  interaction: Interaction,
  memberRoleIds: ReadonlySet<string>,
): RouteInput | null {
  if (interaction.isButton()) {
    return { type: "button", customId: interaction.customId, memberRoleIds };
  }
  if (interaction.isAnySelectMenu()) {
    return { type: "select", customId: interaction.customId, memberRoleIds };
  }
  if (interaction.isModalSubmit()) {
    return { type: "modal", customId: interaction.customId, memberRoleIds };
  }
  if (interaction.isAutocomplete() || interaction.isChatInputCommand()) {
    return {
      type: interaction.isAutocomplete() ? "autocomplete" : "command",
      command: interaction.commandName,
      subcommandGroup: interaction.options.getSubcommandGroup(false),
      subcommand: interaction.options.getSubcommand(false),
      memberRoleIds,
    };
  }
  if (interaction.isUserContextMenuCommand()) {
    return { type: "user-context", command: interaction.commandName, memberRoleIds };
  }
  return null;
}

function memberRoleIds(interaction: Interaction): ReadonlySet<string> {
  const roles = interaction.member?.roles;
  if (roles === undefined) return new Set();
  return new Set(Array.isArray(roles) ? roles : roles.cache.keys());
}

async function sayPrivately(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;
  const payload = { content, flags: PRIVATE };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

async function respondEmpty(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete() && !interaction.responded) await interaction.respond([]);
}

export async function handleInteraction(
  ctx: AppContext,
  handlers: Handlers,
  interaction: Interaction,
): Promise<void> {
  const input = routeInput(interaction, memberRoleIds(interaction));
  if (input === null) return;
  const result = route(input, ctx.config.adminRoleId);
  const autocomplete = input.type === "autocomplete";

  try {
    if ("denied" in result || "unknown" in result) {
      if (autocomplete) await respondEmpty(interaction);
      else
        await sayPrivately(interaction, "denied" in result ? "Only admins can do that." : EXPIRED);
      return;
    }
    const handler = handlers[result.handler];
    if (handler === undefined) {
      if (autocomplete) await respondEmpty(interaction);
      else await sayPrivately(interaction, EXPIRED);
      return;
    }
    try {
      await handler(ctx, interaction);
    } catch (error) {
      if (autocomplete) {
        console.error(`Autocomplete ${result.handler} failed`, error);
        await respondEmpty(interaction);
      } else if (error instanceof UserFacingError) {
        await sayPrivately(interaction, error.message);
      } else {
        console.error(`Handler ${result.handler} failed`, error);
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        await ctx.audit.notifyAdmins(`Error in ${result.handler}:\n${detail}`.slice(0, 1500));
        await sayPrivately(interaction, GENERIC_ERROR);
      }
    }
  } catch (error) {
    console.error("Could not answer an interaction", error);
  }
}
