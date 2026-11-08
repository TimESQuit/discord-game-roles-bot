import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import { expect, test } from "vitest";

import {
  allComponents,
  customIdButtons,
  defined,
  findComponents,
  flagBits,
  textOf,
} from "./payloads.ts";

const container = {
  type: ComponentType.Container,
  components: [
    { type: ComponentType.TextDisplay, content: "one" },
    {
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Primary, label: "A", custom_id: "a" },
        { type: ComponentType.Button, style: ButtonStyle.Link, label: "L", url: "https://x.test" },
      ],
    },
    { type: ComponentType.TextDisplay, content: "two" },
  ],
};

test("allComponents lists parents before children, nested ones included", () => {
  expect(allComponents({ components: [container] }).map((c) => c.type)).toEqual([
    ComponentType.Container,
    ComponentType.TextDisplay,
    ComponentType.ActionRow,
    ComponentType.Button,
    ComponentType.Button,
    ComponentType.TextDisplay,
  ]);
});

test("allComponents follows a modal label to its single component", () => {
  const label = {
    type: ComponentType.Label,
    label: "Name",
    component: { type: ComponentType.TextInput, custom_id: "name", style: 1 },
  };
  expect(allComponents([label]).map((c) => c.type)).toEqual([
    ComponentType.Label,
    ComponentType.TextInput,
  ]);
});

test("builders are read through toJSON and things that are not components are skipped", () => {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("b").setLabel("B").setStyle(ButtonStyle.Secondary),
  );
  const found = allComponents({
    components: [
      row,
      new TextDisplayBuilder().setContent("hi"),
      "text",
      null,
      { type: 9999 },
      { type: "Button" },
      {},
    ],
  });
  expect(found.map((c) => c.type)).toEqual([
    ComponentType.ActionRow,
    ComponentType.Button,
    ComponentType.TextDisplay,
  ]);
});

test("findComponents filters by type; customIdButtons drops link buttons", () => {
  expect(findComponents([container], ComponentType.Button)).toHaveLength(2);
  expect(customIdButtons({ components: [container] }).map((b) => b.custom_id)).toEqual(["a"]);
  expect(findComponents({}, ComponentType.Button)).toEqual([]);
});

test("textOf joins every text display with newlines", () => {
  expect(textOf({ components: [container] })).toBe("one\ntwo");
  expect(textOf({})).toBe("");
});

test("flagBits turns a list of flags into their number", () => {
  expect(flagBits({})).toBe(0);
  expect(flagBits({ flags: [MessageFlags.IsComponentsV2] })).toBe(MessageFlags.IsComponentsV2);
  expect(flagBits({ flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] })).toBe(
    MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  );
});

test("defined returns a present value and throws on undefined or null", () => {
  expect(defined(0)).toBe(0);
  expect(defined("")).toBe("");
  expect(() => defined(undefined, "the game")).toThrow("Expected the game to be defined");
  expect(() => defined(null)).toThrow("Expected value to be defined");
});
