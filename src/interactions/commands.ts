import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

import {
  ALIASES_MAX,
  GAME_NAME_MAX,
  LFG_WHEN_MAX,
  MOVE_DIRECTIONS,
  NOTE_MAX,
} from "../constants.ts";

import type {
  REST,
  RESTPostAPIApplicationGuildCommandsJSONBody,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import type { Config } from "../config.ts";

type StringOption = (o: SlashCommandStringOption) => SlashCommandStringOption;
type Subcommand = (s: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder;

const GUILD_ONLY = [InteractionContextType.Guild];

const gameOption: StringOption = (o) =>
  o.setName("game").setDescription("The game").setRequired(true).setAutocomplete(true);

const nameOption: StringOption = (o) =>
  o.setName("name").setDescription("The name").setRequired(true).setMaxLength(GAME_NAME_MAX);

const aliasOption: StringOption = (o) =>
  o.setName("aliases").setDescription("Other names, separated by commas").setMaxLength(ALIASES_MAX);

const categoryOption =
  (required: boolean): StringOption =>
  (o) =>
    o
      .setName("category")
      .setDescription("The category")
      .setRequired(required)
      .setAutocomplete(true);

/** A subcommand with its description and string options; the table key gives its name. */
const sub =
  (description: string, ...options: StringOption[]): Subcommand =>
  (s) =>
    options.reduce((built, option) => built.addStringOption(option), s.setDescription(description));

/*
 * The subcommands of each slash command, in the order Discord shows them. The command builders
 * and the router both read these tables, so a subcommand is declared once.
 */
const GAMES = {
  menu: sub("Open your private games menu"),
  add: sub("Add a game role", gameOption),
  remove: sub("Remove a game role", gameOption),
  suggest: sub("Suggest a new game"),
  mine: sub("Show your games"),
  who: sub("See who plays a game", gameOption),
  suggestions: sub("Show your open suggestions"),
} satisfies Record<string, Subcommand>;

const GAMEADMIN = {
  setup: sub("Create or repair the bot's channels and roles"),
  backup: sub("Save a database backup now"),
  review: sub("Review pending suggestions"),
  add: sub("Add a game", nameOption, categoryOption(true), aliasOption),
  edit: sub(
    "Edit a game",
    gameOption,
    (o) => o.setName("name").setDescription("The new name").setMaxLength(GAME_NAME_MAX),
    categoryOption(false),
    aliasOption,
  ),
  remove: sub("Remove a game", gameOption),
  "reapply-template": sub("Copy the template role's settings to all game roles"),
  "refresh-panel": sub("Rebuild the panel message"),
  uninstall: sub("Delete the bot's roles and channels and wipe its data"),
} satisfies Record<string, Subcommand>;

/** `/gameadmin category …` */
const GAMEADMIN_CATEGORY = {
  add: sub("Add a category", nameOption),
  rename: sub("Rename a category", categoryOption(true), nameOption),
  move: sub("Move a category up or down", categoryOption(true), (o) =>
    o
      .setName("direction")
      .setDescription("Which way")
      .setRequired(true)
      .addChoices(...MOVE_DIRECTIONS.map((d) => ({ name: d, value: d }))),
  ),
} satisfies Record<string, Subcommand>;

export const SUBCOMMANDS = { games: GAMES, lfg: {}, gameadmin: GAMEADMIN } as const;
export const SUBCOMMAND_GROUPS = { gameadmin: { category: GAMEADMIN_CATEGORY } } as const;

/** User context menus: handler name → the name shown in Discord. */
export const USER_MENUS = {
  "ctx-see-games": "See their games",
  "ctx-in-common": "Games in common",
} as const;

export type CommandName = keyof typeof SUBCOMMANDS;
export type GamesSubcommand = keyof typeof GAMES;
export type GameadminSubcommand = keyof typeof GAMEADMIN;
export type GameadminCategorySubcommand = keyof typeof GAMEADMIN_CATEGORY;

/** The keys of a table, typed as its own keys. */
export const keysOf = <T extends object>(table: T): (keyof T & string)[] =>
  Object.keys(table).filter((key): key is keyof T & string => Object.hasOwn(table, key));

/** True when `key` names an entry of `table`. */
export const hasKey = <T extends object>(table: T, key: string): key is keyof T & string =>
  Object.hasOwn(table, key);

function addSubcommands<B extends { addSubcommand(input: Subcommand): unknown }>(
  builder: B,
  table: Record<string, Subcommand>,
): B {
  for (const [name, configure] of Object.entries(table)) {
    builder.addSubcommand((s) => configure(s.setName(name)));
  }
  return builder;
}

function slashCommand(name: CommandName, description: string): SlashCommandBuilder {
  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(GUILD_ONLY);
  return addSubcommands(builder, SUBCOMMANDS[name]);
}

function lfg(): SlashCommandBuilder {
  const builder = slashCommand("lfg", "Look for a group");
  builder
    .addStringOption(gameOption)
    .addStringOption((o) =>
      o.setName("when").setDescription("When you want to play").setMaxLength(LFG_WHEN_MAX),
    )
    .addStringOption((o) =>
      o.setName("note").setDescription("A short note").setMaxLength(NOTE_MAX),
    );
  return builder;
}

function gameadmin(): SlashCommandBuilder {
  const builder = slashCommand("gameadmin", "Manage the game roles");
  builder.addSubcommandGroup((g) =>
    addSubcommands(
      g.setName("category").setDescription("Manage categories"),
      SUBCOMMAND_GROUPS.gameadmin.category,
    ),
  );
  return builder;
}

const userMenu = (name: string): ContextMenuCommandBuilder =>
  new ContextMenuCommandBuilder()
    .setName(name)
    .setType(ApplicationCommandType.User)
    .setContexts(GUILD_ONLY);

export function commandDefinitions(): RESTPostAPIApplicationGuildCommandsJSONBody[] {
  return [
    slashCommand("games", "Pick the games you play").toJSON(),
    lfg().toJSON(),
    gameadmin().toJSON(),
    ...Object.values(USER_MENUS).map((name) => userMenu(name).toJSON()),
  ];
}

export async function registerCommands(rest: REST, config: Config): Promise<void> {
  await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), {
    body: commandDefinitions(),
  });
}
