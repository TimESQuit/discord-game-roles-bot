import type { REST } from "discord.js";
import { Routes } from "discord.js";
import { expect, test } from "vitest";
import { commandDefinitions, registerCommands } from "../../src/interactions/commands.ts";
import type { Config } from "../../src/config.ts";

type Opt = {
  name: string;
  type: number;
  required?: boolean;
  autocomplete?: boolean;
  max_length?: number;
  choices?: { value: string }[];
  options?: Opt[];
};
type Cmd = { name: string; type?: number; options?: Opt[] };

const defs = (): Cmd[] => commandDefinitions() as unknown as Cmd[];
const find = (name: string): Cmd => {
  const c = defs().find((d) => d.name === name);
  if (!c) throw new Error(`missing ${name}`);
  return c;
};
const sub = (c: { options?: Opt[] }, name: string): Opt => {
  const s = c.options?.find((o) => o.name === name);
  if (!s) throw new Error(`missing ${name}`);
  return s;
};

test("names are short and there are two user context menus", () => {
  for (const d of defs()) expect(d.name.length).toBeLessThanOrEqual(32);
  const menus = defs().filter((d) => d.type === 2);
  expect(menus.map((m) => m.name).toSorted()).toEqual(["Games in common", "See their games"]);
});

test("/games subcommands and autocomplete game options", () => {
  const games = find("games");
  expect(games.options?.map((o) => o.name)).toEqual([
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
    expect(game).toMatchObject({ type: 3, required: true, autocomplete: true });
  }
});

test("/lfg options", () => {
  const lfg = find("lfg");
  expect(lfg.options?.map((o) => o.name)).toEqual(["game", "when", "note"]);
  expect(sub(lfg, "game")).toMatchObject({ required: true, autocomplete: true });
  expect(sub(lfg, "when")).toMatchObject({ max_length: 100 });
  expect(sub(lfg, "note")).toMatchObject({ max_length: 300 });
  expect(sub(lfg, "when").required).toBeFalsy();
});

test("/gameadmin shape", () => {
  const admin = find("gameadmin");
  expect(admin.options?.map((o) => o.name)).toEqual([
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
  expect(sub(sub(admin, "add"), "category")).toMatchObject({ autocomplete: true, type: 3 });
  expect(sub(sub(admin, "edit"), "game")).toMatchObject({ autocomplete: true, required: true });
  const cat = sub(admin, "category");
  expect(cat.type).toBe(2);
  expect(cat.options?.map((o) => o.name)).toEqual(["add", "rename", "move"]);
  const dir = sub(sub(cat, "move"), "direction");
  expect(dir.choices?.map((c) => c.value)).toEqual(["up", "down"]);
});

test("registerCommands PUTs the guild commands", async () => {
  const calls: unknown[][] = [];
  const rest = {
    put: async (...args: unknown[]) => {
      calls.push(args);
      return [];
    },
  } as unknown as REST;
  const config = { applicationId: "100000000000000100", guildId: "100000000000000200" } as Config;
  await registerCommands(rest, config);
  expect(calls).toEqual([
    [
      Routes.applicationGuildCommands("100000000000000100", "100000000000000200"),
      { body: commandDefinitions() },
    ],
  ]);
});
