import { DISCORD_ERROR, isDiscordError } from "../discord/index.ts";
import {
  ADMIN_ACTIONS,
  CUSTOM_ID_KINDS,
  MENU_ACTIONS,
  PURPOSES,
  isAdmin,
  isAdminId,
  parseId,
} from "../domain/index.ts";
import { messageOf, UserFacingError } from "../errors.ts";
import { noticeView } from "../views/index.ts";
import { SUBCOMMANDS, SUBCOMMAND_GROUPS, USER_MENUS, hasKey, keysOf } from "./commands.ts";
import { forReply } from "./replies.ts";

import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  BaseInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserContextMenuCommandInteraction,
} from "discord.js";
import type {
  AdminAction,
  CustomId,
  CustomIdKind,
  MenuAction,
  PickPurpose,
} from "../domain/index.ts";
import type { AppContext } from "../services/index.ts";
import type {
  CommandName,
  GameadminCategorySubcommand,
  GameadminSubcommand,
  GamesSubcommand,
} from "./commands.ts";

/** ID kinds that route on one of their arguments as well (`menu` + action → `menu-add`). */
type CompoundKind = "menu" | "admin" | "pick" | "pick-page";

/** The handler names custom IDs route to: the kind, plus the action or purpose for compound kinds. */
type IdHandlerName =
  | Exclude<CustomIdKind, CompoundKind>
  | `menu-${MenuAction}`
  | `admin-${AdminAction}`
  | `pick-${PickPurpose}`
  | `pick-page-${PickPurpose}`;

/** The handler names slash commands, their autocomplete and the context menus route to. */
type CommandHandlerName =
  | `games-${GamesSubcommand}`
  | "lfg"
  | `gameadmin-${GameadminSubcommand}`
  | `gameadmin-category-${GameadminCategorySubcommand}`
  | `autocomplete-${CommandName}`
  | keyof typeof USER_MENUS;

export type HandlerName = IdHandlerName | CommandHandlerName;

const isCompound = (kind: CustomIdKind): kind is CompoundKind =>
  kind === "menu" || kind === "admin" || kind === "pick" || kind === "pick-page";
const isSimple = (kind: CustomIdKind): kind is Exclude<CustomIdKind, CompoundKind> =>
  !isCompound(kind);

/** Every name the router can return, derived from the ID schema and the command tables. */
export const HANDLER_NAMES: readonly HandlerName[] = [
  ...CUSTOM_ID_KINDS.filter(isSimple),
  ...MENU_ACTIONS.map((action) => `menu-${action}` as const),
  ...ADMIN_ACTIONS.map((action) => `admin-${action}` as const),
  ...PURPOSES.flatMap((purpose) => [`pick-${purpose}` as const, `pick-page-${purpose}` as const]),
  ...keysOf(SUBCOMMANDS.games).map((sub) => `games-${sub}` as const),
  "lfg",
  ...keysOf(SUBCOMMANDS.gameadmin).map((sub) => `gameadmin-${sub}` as const),
  ...keysOf(SUBCOMMAND_GROUPS.gameadmin.category).map(
    (sub) => `gameadmin-category-${sub}` as const,
  ),
  ...keysOf(SUBCOMMANDS).map((command) => `autocomplete-${command}` as const),
  ...keysOf(USER_MENUS),
];

export type Handler = (ctx: AppContext, interaction: BaseInteraction) => Promise<void>;
export type Handlers = Partial<Record<HandlerName, Handler>>;

const wrongKind = (kind: string): Error => new Error(`Expected a ${kind} interaction`);

/*
 * Routing already decides the kind of interaction a handler gets. These wrappers check it again
 * with discord.js's own guards, so each handler's declared interaction type is checked, not
 * assumed.
 */
export const button =
  (fn: (ctx: AppContext, interaction: ButtonInteraction) => Promise<void>): Handler =>
  async (ctx, interaction) => {
    if (!interaction.isButton()) throw wrongKind("button");
    await fn(ctx, interaction);
  };

export const select =
  (fn: (ctx: AppContext, interaction: StringSelectMenuInteraction) => Promise<void>): Handler =>
  async (ctx, interaction) => {
    if (!interaction.isStringSelectMenu()) throw wrongKind("string select menu");
    await fn(ctx, interaction);
  };

export const modal =
  (fn: (ctx: AppContext, interaction: ModalSubmitInteraction) => Promise<void>): Handler =>
  async (ctx, interaction) => {
    if (!interaction.isModalSubmit()) throw wrongKind("modal submit");
    await fn(ctx, interaction);
  };

export const chatInput =
  (fn: (ctx: AppContext, interaction: ChatInputCommandInteraction) => Promise<void>): Handler =>
  async (ctx, interaction) => {
    if (!interaction.isChatInputCommand()) throw wrongKind("chat input command");
    await fn(ctx, interaction);
  };

export const autocomplete =
  (fn: (ctx: AppContext, interaction: AutocompleteInteraction) => Promise<void>): Handler =>
  async (ctx, interaction) => {
    if (!interaction.isAutocomplete()) throw wrongKind("autocomplete");
    await fn(ctx, interaction);
  };

export const userContext =
  (
    fn: (ctx: AppContext, interaction: UserContextMenuCommandInteraction) => Promise<void>,
  ): Handler =>
  async (ctx, interaction) => {
    if (!interaction.isUserContextMenuCommand()) throw wrongKind("user context menu command");
    await fn(ctx, interaction);
  };

export const buttonOrChatInput =
  (
    fn: (
      ctx: AppContext,
      interaction: ButtonInteraction | ChatInputCommandInteraction,
    ) => Promise<void>,
  ): Handler =>
  async (ctx, interaction) => {
    if (!interaction.isButton() && !interaction.isChatInputCommand()) {
      throw wrongKind("button or chat input command");
    }
    await fn(ctx, interaction);
  };

export type RouteInput = {
  type: "button" | "select" | "modal" | "command" | "autocomplete" | "user-context";
  customId?: string;
  command?: string;
  subcommandGroup?: string | null;
  subcommand?: string | null;
  memberRoleIds: ReadonlySet<string>;
};

export type RouteResult = { handler: HandlerName } | { denied: true } | { unknown: true };

function idHandlerName(id: CustomId): IdHandlerName {
  switch (id.kind) {
    case "menu":
      return `menu-${id.action}`;
    case "admin":
      return `admin-${id.action}`;
    case "pick":
      return `pick-${id.purpose}`;
    case "pick-page":
      return `pick-page-${id.purpose}`;
    default:
      return id.kind;
  }
}

function userMenuHandlerName(menu: string | undefined): CommandHandlerName | null {
  return keysOf(USER_MENUS).find((name) => USER_MENUS[name] === menu) ?? null;
}

/** Only names from the command tables resolve, so a command can never spell another handler. */
function commandHandlerName(input: RouteInput): CommandHandlerName | null {
  const { command, subcommand, subcommandGroup } = input;
  if (command === undefined || !hasKey(SUBCOMMANDS, command)) return null;
  if (input.type === "autocomplete") return `autocomplete-${command}`;
  if (command === "lfg") return "lfg";
  if (subcommand === undefined || subcommand === null) return null;
  if (command === "gameadmin") {
    if (subcommandGroup) {
      return subcommandGroup === "category" &&
        hasKey(SUBCOMMAND_GROUPS.gameadmin.category, subcommand)
        ? `gameadmin-category-${subcommand}`
        : null;
    }
    return hasKey(SUBCOMMANDS.gameadmin, subcommand) ? `gameadmin-${subcommand}` : null;
  }
  return !subcommandGroup && hasKey(SUBCOMMANDS.games, subcommand) ? `games-${subcommand}` : null;
}

export function route(input: RouteInput, adminRoleId: string): RouteResult {
  let name: HandlerName | null;
  let adminOnly: boolean;

  if (input.type === "user-context") {
    name = userMenuHandlerName(input.command);
    adminOnly = false;
  } else if (input.type === "command" || input.type === "autocomplete") {
    name = commandHandlerName(input);
    // Any /gameadmin spelling is admin-only, even one that resolves to no handler.
    adminOnly = input.command === "gameadmin";
  } else {
    const id = input.customId === undefined ? null : parseId(input.customId);
    if (id === null) return { unknown: true };
    name = idHandlerName(id);
    adminOnly = isAdminId(id);
  }

  if (adminOnly && !isAdmin(input.memberRoleIds, adminRoleId)) return { denied: true };
  return name === null ? { unknown: true } : { handler: name };
}

const GENERIC_ERROR = "Something went wrong. The admins have been told.";
const EXPIRED = "That button has expired. Open the menu again.";

function routeInput(interaction: BaseInteraction, roleIds: ReadonlySet<string>): RouteInput | null {
  if (interaction.isButton()) {
    return { type: "button", customId: interaction.customId, memberRoleIds: roleIds };
  }
  if (interaction.isAnySelectMenu()) {
    return { type: "select", customId: interaction.customId, memberRoleIds: roleIds };
  }
  if (interaction.isModalSubmit()) {
    return { type: "modal", customId: interaction.customId, memberRoleIds: roleIds };
  }
  if (interaction.isAutocomplete() || interaction.isChatInputCommand()) {
    return {
      type: interaction.isAutocomplete() ? "autocomplete" : "command",
      command: interaction.commandName,
      subcommandGroup: interaction.options.getSubcommandGroup(false),
      subcommand: interaction.options.getSubcommand(false),
      memberRoleIds: roleIds,
    };
  }
  if (interaction.isUserContextMenuCommand()) {
    return { type: "user-context", command: interaction.commandName, memberRoleIds: roleIds };
  }
  return null;
}

export function memberRoleIds(interaction: BaseInteraction): ReadonlySet<string> {
  const roles = interaction.member?.roles;
  if (roles === undefined) return new Set();
  return new Set(Array.isArray(roles) ? roles : roles.cache.keys());
}

async function sayPrivately(interaction: BaseInteraction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;
  const payload = forReply(noticeView(content));
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

async function respondEmpty(interaction: BaseInteraction): Promise<void> {
  if (interaction.isAutocomplete() && !interaction.responded) await interaction.respond([]);
}

export async function handleInteraction(
  ctx: AppContext,
  handlers: Handlers,
  interaction: BaseInteraction,
): Promise<void> {
  const receivedAt = Date.now();
  const input = routeInput(interaction, memberRoleIds(interaction));
  if (input === null) {
    console.warn(`Ignoring an unhandled interaction type (${interaction.type})`);
    return;
  }
  const result = route(input, ctx.config.adminRoleId);
  const isAutocompleteInput = input.type === "autocomplete";

  try {
    if ("denied" in result || "unknown" in result) {
      if (isAutocompleteInput) await respondEmpty(interaction);
      else
        await sayPrivately(interaction, "denied" in result ? "Only admins can do that." : EXPIRED);
      return;
    }
    const handler = handlers[result.handler];
    if (handler === undefined) {
      if (isAutocompleteInput) await respondEmpty(interaction);
      else await sayPrivately(interaction, EXPIRED);
      return;
    }
    try {
      await handler(ctx, interaction);
    } catch (error) {
      if (isAutocompleteInput) {
        console.error(`Autocomplete ${result.handler} failed`, error);
        await respondEmpty(interaction);
      } else if (error instanceof UserFacingError) {
        await sayPrivately(interaction, error.message);
      } else if (isDiscordError(error, DISCORD_ERROR.unknownInteraction)) {
        // Discord's 3-second window closed before the reply, so no reply can reach the member.
        // Nothing for the admins to act on: record it, with how late the click arrived.
        const created = interaction.createdTimestamp;
        await ctx.audit.log({
          kind: "interaction-expired",
          userId: interaction.user.id,
          handler: result.handler,
          receivedMs: receivedAt - created,
          failedMs: Date.now() - created,
        });
      } else {
        console.error(`Handler ${result.handler} failed`, error);
        try {
          await sayPrivately(interaction, GENERIC_ERROR);
        } catch (replyError) {
          console.error("Could not send the error reply", replyError);
        }
        await ctx.audit.reportError(
          `Error in ${result.handler}: ${messageOf(error)}`.slice(0, 1500),
        );
      }
    }
  } catch (error) {
    console.error("Could not answer an interaction", error);
  }
}
