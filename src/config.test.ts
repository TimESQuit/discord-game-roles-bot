import { expect, test } from "vitest";

import { loadConfig } from "./config.ts";

const valid = {
  DISCORD_TOKEN: "t",
  DISCORD_APPLICATION_ID: "100000000000000001",
  DISCORD_GUILD_ID: "100000000000000002",
  ADMIN_ROLE_ID: "100000000000000003",
};

test("defaults", () => {
  expect(loadConfig(valid)).toMatchObject({
    healthcheckUrl: null,
    databasePath: "data/bot.sqlite",
    backupHourUtc: 4,
  });
});

test("lists every missing variable at once", () => {
  expect(() => loadConfig({})).toThrow(
    /DISCORD_TOKEN.*DISCORD_APPLICATION_ID.*DISCORD_GUILD_ID.*ADMIN_ROLE_ID/s,
  );
});

test("rejects non-snowflake IDs without echoing the value", () => {
  expect(() => loadConfig({ ...valid, DISCORD_GUILD_ID: "abc" })).toThrow(/DISCORD_GUILD_ID/);
  expect(() => loadConfig({ ...valid, DISCORD_GUILD_ID: "abc" })).not.toThrow(/abc/);
});

test("empty HEALTHCHECK_URL means none; non-https is rejected", () => {
  expect(loadConfig({ ...valid, HEALTHCHECK_URL: "" }).healthcheckUrl).toBeNull();
  expect(loadConfig({ ...valid, HEALTHCHECK_URL: "https://example.com/ping" }).healthcheckUrl).toBe(
    "https://example.com/ping",
  );
  expect(() => loadConfig({ ...valid, HEALTHCHECK_URL: "http://x" })).toThrow(/HEALTHCHECK_URL/);
});

test("BACKUP_HOUR_UTC must be 0-23", () => {
  expect(loadConfig({ ...valid, BACKUP_HOUR_UTC: "23" }).backupHourUtc).toBe(23);
  expect(() => loadConfig({ ...valid, BACKUP_HOUR_UTC: "24" })).toThrow(/BACKUP_HOUR_UTC/);
  expect(() => loadConfig({ ...valid, BACKUP_HOUR_UTC: "x" })).toThrow(/BACKUP_HOUR_UTC/);
});
