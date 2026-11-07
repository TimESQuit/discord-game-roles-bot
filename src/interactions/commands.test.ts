import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  REST,
  Routes,
  type APIApplicationCommandOption,
  type RESTPostAPIApplicationGuildCommandsJSONBody,
} from "discord.js";
import { expect, test, vi } from "vitest";
import { commandDefinitions, registerCommands } from "./commands.ts";
import type { Config } from "../config.ts";

const defs = commandDefinitions;
const find = (name: string): ReturnType<typeof commandDefinitions>[number] => {
  const c = defs().find((d) => d.name === name);
  if (!c) throw new Error(`missing ${name}`);
  return c;
};
/** The options of a command, subcommand or group; other options have none. */
type Node = RESTPostAPIApplicationGuildCommandsJSONBody | APIApplicationCommandOption;
const optionsOf = (c: Node): readonly APIApplicationCommandOption[] =>
  "options" in c ? (c.options ?? []) : [];
const namesOf = (c: Node): string[] => optionsOf(c).map((o) => o.name);
const sub = (c: Node, name: string): APIApplicationCommandOption => {
  const s = optionsOf(c).find((o) => o.name === name);
  if (!s) throw new Error(`missing ${name}`);
  return s;
};

test("names are short and there are two user context menus", () => {
  for (const d of defs()) expect(d.name.length).toBeLessThanOrEqual(32);
  const menus = defs().filter((d) => d.type === ApplicationCommandType.User);
  expect(menus.map((m) => m.name).toSorted()).toEqual(["Games in common", "See their games"]);
});

test("/games subcommands and autocomplete game options", () => {
  const games = find("games");
  expect(namesOf(games)).toEqual([
    "menu",
    "add",
    "remove",
    "suggest",
    "mine",
    "who",
    "suggestions",
  ]);
  for (const name of ["add", "remove", "who"]) {
    const game = sub(sub(games, name), "game");
    expect(game).toMatchObject({
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    });
  }
});

test("/lfg options", () => {
  const lfg = find("lfg");
  expect(namesOf(lfg)).toEqual(["game", "when", "note"]);
  expect(sub(lfg, "game")).toMatchObject({ required: true, autocomplete: true });
  expect(sub(lfg, "when")).toMatchObject({ max_length: 100 });
  expect(sub(lfg, "note")).toMatchObject({ max_length: 300 });
  expect(sub(lfg, "when")).not.toMatchObject({ required: true });
});

test("/gameadmin shape", () => {
  const admin = find("gameadmin");
  expect(namesOf(admin)).toEqual([
    "setup",
    "backup",
    "review",
    "add",
    "edit",
    "remove",
    "reapply-template",
    "refresh-panel",
    "category",
  ]);
  expect(sub(sub(admin, "add"), "category")).toMatchObject({
    autocomplete: true,
    type: ApplicationCommandOptionType.String,
  });
  expect(sub(sub(admin, "edit"), "game")).toMatchObject({ autocomplete: true, required: true });
  const cat = sub(admin, "category");
  expect(cat.type).toBe(ApplicationCommandOptionType.SubcommandGroup);
  expect(namesOf(cat)).toEqual(["add", "rename", "move"]);
  const dir = sub(sub(cat, "move"), "direction");
  expect(dir).toMatchObject({ choices: [{ value: "up" }, { value: "down" }] });
});

test("registerCommands PUTs the guild commands", async () => {
  const rest = new REST();
  const put = vi.spyOn(rest, "put").mockResolvedValue([]);
  const config: Config = {
    token: "test-token",
    applicationId: "100000000000000100",
    guildId: "100000000000000200",
    adminRoleId: "100000000000000300",
    healthcheckUrl: null,
    databasePath: ":memory:",
    backupHourUtc: 4,
  };
  await registerCommands(rest, config);
  expect(put.mock.calls).toEqual([
    [
      Routes.applicationGuildCommands("100000000000000100", "100000000000000200"),
      { body: commandDefinitions() },
    ],
  ]);
});
