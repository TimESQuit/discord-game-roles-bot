import { escapeMarkdown } from "discord.js";

/** discord.js leaves these off by default; without them a masked link or heading still renders. */
const ESCAPE_ALL = {
  maskedLink: true,
  heading: true,
  bulletedList: true,
  numberedList: true,
} as const;

/** Escapes Markdown and breaks up "@" so user-typed text can neither format nor ping. */
export function text(value: string): string {
  return escapeMarkdown(value, ESCAPE_ALL).replaceAll("@", "@​");
}
