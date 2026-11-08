import { STARTING_CATEGORIES, TEMPLATE_ROLE_NAME } from "../constants.ts";
import { openDatabase, createRepos, SETUP_KEYS } from "../db/index.ts";
import { createAudit } from "../services/index.ts";
import { FakeGateway } from "./fake-gateway.ts";

import type { Config } from "../config.ts";
import type { Db, SetupKey } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { AppContext } from "../services/index.ts";

export const TEMPLATE_COLOR = 0x5865f2;
export const templatePosition = 10;
export const TEMPLATE_ROLE_ID = "100000000000000500";
export const ADMIN_ROLE_ID = "100000000000000600";
export const U1 = "100000000000000001";
export const U2 = "100000000000000002";
export const U3 = "100000000000000003";
export const A1 = "100000000000000011";
export const A2 = "100000000000000012";

type ChannelKey = Exclude<SetupKey, "templateRoleId" | "panelMessageId">;
const isChannelKey = (key: SetupKey): key is ChannelKey =>
  key !== "templateRoleId" && key !== "panelMessageId";
const CHANNEL_KEYS = SETUP_KEYS.filter(isChannelKey);

/** Reads the setup table directly, so it must track src/db/schema.ts. Synchronous read of a setup value, so the `logLines` and `adminNotices` getters stay synchronous. */
function setupValue(db: Db, key: SetupKey): string | undefined {
  const row = db.sqlite
    .prepare<[string], { value: string }>("SELECT value FROM setup WHERE key = ?")
    .get(key);
  return row?.value;
}

export type TestContext = AppContext & {
  db: Db;
  gateway: FakeGateway;
  logLines: string[];
  adminNotices: string[];
};

export async function makeContext(
  overrides: { setup?: boolean; now?: Date; config?: Partial<Config> } = {},
): Promise<TestContext> {
  const gateway = new FakeGateway({});
  const db = openDatabase(":memory:");
  const repos = createRepos(db.kysely);
  const config: Config = {
    token: "test-token",
    applicationId: "100000000000000100",
    guildId: gateway.guildId,
    adminRoleId: ADMIN_ROLE_ID,
    databasePath: ":memory:",
    backupHourUtc: 4,
    ...overrides.config,
  };
  const now = overrides.now ?? new Date("2026-01-15T12:00:00Z");

  gateway.setBotTopPosition(templatePosition + 5);
  if (overrides.setup ?? true) {
    for (const name of STARTING_CATEGORIES) await repos.categories.add(name);
    gateway.addRole({
      id: TEMPLATE_ROLE_ID,
      name: TEMPLATE_ROLE_NAME,
      position: templatePosition,
      color: TEMPLATE_COLOR,
      mentionable: true,
    });
    await repos.setup.set("templateRoleId", TEMPLATE_ROLE_ID);
    let next = 100000000000000700n;
    for (const key of CHANNEL_KEYS) {
      const id = (next++).toString();
      gateway.addChannel(id);
      await repos.setup.set(key, id);
    }
  }

  const messagesIn = (key: SetupKey): string[] => {
    const channelId = setupValue(db, key);
    return (channelId ? (gateway.messages.get(channelId) ?? []) : []).map(
      (m) => m.payload.content ?? "",
    );
  };

  return {
    config,
    db,
    repos,
    gateway,
    audit: createAudit(repos, gateway),
    now: () => new Date(now),
    get logLines() {
      return messagesIn("logChannelId");
    },
    get adminNotices() {
      return messagesIn("adminChannelId");
    },
  };
}

export function sentTo(ctx: TestContext, key: SetupKey): Payload[] {
  const channelId = setupValue(ctx.db, key);
  return channelId ? (ctx.gateway.messages.get(channelId) ?? []).map((m) => m.payload) : [];
}

export function lastEdit(ctx: TestContext): {
  channelId: string;
  messageId: string;
  payload: Payload;
} {
  const call = ctx.gateway.calls.findLast((c) => c.method === "edit");
  if (!call) throw new Error("No message was edited");
  const [channelId, messageId, payload] = call.args;
  return { channelId, messageId, payload };
}

export function lastSend(ctx: TestContext): { channelId: string; payload: Payload } {
  const call = ctx.gateway.calls.findLast((c) => c.method === "send");
  if (!call) throw new Error("No message was sent");
  const [channelId, payload] = call.args;
  return { channelId, payload };
}
