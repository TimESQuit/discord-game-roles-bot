import { DiscordAPIError } from "discord.js";

/** Discord API error codes the bot reacts to. */
export const DISCORD_ERROR = {
  unknownChannel: 10003,
  unknownMessage: 10008,
  missingAccess: 50001,
  missingPermissions: 50013,
} as const;

/** True when `error` is a Discord API error with one of `codes`. */
export function isDiscordError(error: unknown, ...codes: number[]): boolean {
  return (
    error instanceof DiscordAPIError && typeof error.code === "number" && codes.includes(error.code)
  );
}
