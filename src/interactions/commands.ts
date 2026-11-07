import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  Routes,
  SlashCommandBuilder,
  type REST,
  type RESTPostAPIApplicationGuildCommandsJSONBody,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { Config } from "../config.ts";
import { MOVE_DIRECTIONS } from "../constants.ts";

type Buildable = { toJSON(): RESTPostAPIApplicationGuildCommandsJSONBody };

const GUILD_ONLY = [InteractionContextType.Guild];

const gameOption =
  (description = "The game") =>
  (o: SlashCommandStringOption) =>
    o.setName("game").setDescription(description).setRequired(true).setAutocomplete(true);

const nameOption = (o: SlashCommandStringOption) =>
  o.setName("name").setDescription("The name").setRequired(true).setMaxLength(100);

const aliasOption = (o: SlashCommandStringOption) =>
  o.setName("aliases").setDescription("Other names, separated by commas").setMaxLength(300);

function games(): Buildable {
  return new SlashCommandBuilder()
    .setName("games")
    .setDescription("Pick the games you play")
    .setContexts(GUILD_ONLY)
    .addSubcommand((s) => s.setName("menu").setDescription("Open your private games menu"))
    .addSubcommand((s) =>
      s.setName("add").setDescription("Add a game role").addStringOption(gameOption()),
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Remove a game role").addStringOption(gameOption()),
    )
    .addSubcommand((s) => s.setName("suggest").setDescription("Suggest a new game"))
    .addSubcommand((s) => s.setName("mine").setDescription("Show your games"))
    .addSubcommand((s) =>
      s.setName("who").setDescription("See who plays a game").addStringOption(gameOption()),
    )
    .addSubcommand((s) => s.setName("suggestions").setDescription("Show your open suggestions"));
}

function lfg(): Buildable {
  return new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Look for a group")
    .setContexts(GUILD_ONLY)
    .addStringOption(gameOption())
    .addStringOption((o) =>
      o.setName("when").setDescription("When you want to play").setMaxLength(100),
    )
    .addStringOption((o) => o.setName("note").setDescription("A short note").setMaxLength(300));
}

const categoryOption = (required: boolean) => (o: SlashCommandStringOption) =>
  o.setName("category").setDescription("The category").setRequired(required).setAutocomplete(true);

const sub = (name: string, description: string) => (s: SlashCommandSubcommandBuilder) =>
  s.setName(name).setDescription(description);

function gameadmin(): Buildable {
  return new SlashCommandBuilder()
    .setName("gameadmin")
    .setDescription("Manage the game roles")
    .setContexts(GUILD_ONLY)
    .addSubcommand(sub("setup", "Create or repair the bot's channels and roles"))
    .addSubcommand(sub("backup", "Save a database backup now"))
    .addSubcommand(sub("review", "Review pending suggestions"))
    .addSubcommand((s) =>
      sub(
        "add",
        "Add a game",
      )(s)
        .addStringOption(nameOption)
        .addStringOption(categoryOption(true))
        .addStringOption(aliasOption),
    )
    .addSubcommand((s) =>
      sub(
        "edit",
        "Edit a game",
      )(s)
        .addStringOption(gameOption())
        .addStringOption((o) => o.setName("name").setDescription("The new name").setMaxLength(100))
        .addStringOption(categoryOption(false))
        .addStringOption(aliasOption),
    )
    .addSubcommand((s) => sub("remove", "Remove a game")(s).addStringOption(gameOption()))
    .addSubcommand(sub("reapply-template", "Copy the template role's settings to all game roles"))
    .addSubcommand(sub("refresh-panel", "Rebuild the panel message"))
    .addSubcommandGroup((g) =>
      g
        .setName("category")
        .setDescription("Manage categories")
        .addSubcommand((s) => sub("add", "Add a category")(s).addStringOption(nameOption))
        .addSubcommand((s) =>
          sub(
            "rename",
            "Rename a category",
          )(s)
            .addStringOption(categoryOption(true))
            .addStringOption(nameOption),
        )
        .addSubcommand((s) =>
          sub(
            "move",
            "Move a category up or down",
          )(s)
            .addStringOption(categoryOption(true))
            .addStringOption((o) =>
              o
                .setName("direction")
                .setDescription("Which way")
                .setRequired(true)
                .addChoices(...MOVE_DIRECTIONS.map((d) => ({ name: d, value: d }))),
            ),
        ),
    );
}

function userMenu(name: string): ContextMenuCommandBuilder {
  return new ContextMenuCommandBuilder()
    .setName(name)
    .setType(ApplicationCommandType.User)
    .setContexts(GUILD_ONLY);
}

export function commandDefinitions(): RESTPostAPIApplicationGuildCommandsJSONBody[] {
  return [
    games().toJSON(),
    lfg().toJSON(),
    gameadmin().toJSON(),
    userMenu("See their games").toJSON(),
    userMenu("Games in common").toJSON(),
  ];
}

export async function registerCommands(rest: REST, config: Config): Promise<void> {
  await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), {
    body: commandDefinitions(),
  });
}
