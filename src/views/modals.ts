import { LabelBuilder, StringSelectMenuBuilder, TextInputBuilder } from "discord.js";

import { TEXT_LIMIT } from "../constants.ts";
import { truncate } from "./limits.ts";

import type { TextInputStyle } from "discord.js";
import type { Category } from "../db/index.ts";

/** Field IDs inside the modals (read back with `interaction.fields`). */
export const FIELD = {
  name: "name",
  category: "category",
  note: "note",
  aliases: "aliases",
  reason: "reason",
} as const;

export const textInput = (
  id: string,
  style: TextInputStyle,
  max: number,
  required: boolean,
  value?: string,
): TextInputBuilder => {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(style)
    .setMaxLength(max)
    .setRequired(required);
  if (value) input.setValue(truncate(value, max));
  return input;
};

export const inputLabel = (label: string, input: TextInputBuilder): LabelBuilder =>
  new LabelBuilder().setLabel(label).setTextInputComponent(input);

export function categoryLabel(categories: readonly Category[], currentId?: number): LabelBuilder {
  return new LabelBuilder().setLabel("Category").setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId(FIELD.category)
      .setRequired(true)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        categories.map((c) => ({
          label: truncate(c.name, TEXT_LIMIT),
          value: String(c.id),
          default: c.id === currentId,
        })),
      ),
  );
}
