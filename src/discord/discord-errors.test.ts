import { DiscordAPIError } from "discord.js";
import { describe, expect, it } from "vitest";

import { DISCORD_ERROR, isDiscordError } from "./discord-errors.ts";

const apiError = (code: number) =>
  new DiscordAPIError({ code, message: "x" }, code, 404, "GET", "/", {});

describe("isDiscordError", () => {
  it("matches any of the given codes", () => {
    const error = apiError(DISCORD_ERROR.unknownMessage);
    expect(isDiscordError(error, DISCORD_ERROR.unknownChannel, DISCORD_ERROR.unknownMessage)).toBe(
      true,
    );
  });

  it("rejects other codes and non-Discord errors", () => {
    expect(
      isDiscordError(apiError(DISCORD_ERROR.missingAccess), DISCORD_ERROR.unknownChannel),
    ).toBe(false);
    expect(isDiscordError(new Error("x"), DISCORD_ERROR.unknownChannel)).toBe(false);
  });
});
