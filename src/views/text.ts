import { escapeMarkdown } from "discord.js";

/** Escapes Markdown and breaks up "@" so user-typed text can neither format nor ping. */
export function text(value: string): string {
  return escapeMarkdown(value).replaceAll("@", "@​");
}
