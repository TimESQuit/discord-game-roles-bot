import { ApplicationCommandOptionType, REST, Routes } from "discord.js";
import { expect, test, vi } from "vitest";

import { commandDefinitions, registerCommands } from "./commands.ts";

import type {
  APIApplicationCommandOption,
  RESTPostAPIApplicationGuildCommandsJSONBody,
} from "discord.js";
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
const sub = (c: Node, name: string): APIApplicationCommandOption => {
  const s = optionsOf(c).find((o) => o.name === name);
  if (!s) throw new Error(`missing ${name}`);
  return s;
};

test("/games autocomplete game options", () => {
  const games = find("games");
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
  expect(sub(lfg, "game")).toMatchObject({ required: true, autocomplete: true });
  expect(sub(lfg, "when")).toMatchObject({ max_length: 100 });
  expect(sub(lfg, "note")).toMatchObject({ max_length: 300 });
  expect(sub(lfg, "when")).not.toMatchObject({ required: true });
});

test("/gameadmin autocomplete options and category subcommand group", () => {
  const admin = find("gameadmin");
  expect(sub(sub(admin, "add"), "category")).toMatchObject({
    autocomplete: true,
    type: ApplicationCommandOptionType.String,
  });
  expect(sub(sub(admin, "edit"), "game")).toMatchObject({ autocomplete: true, required: true });
  const cat = sub(admin, "category");
  expect(cat.type).toBe(ApplicationCommandOptionType.SubcommandGroup);
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
