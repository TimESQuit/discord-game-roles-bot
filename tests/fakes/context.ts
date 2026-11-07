import { STARTING_CATEGORIES } from "../../src/constants.ts";
import type { Config } from "../../src/config.ts";
import { openDatabase } from "../../src/db/database.ts";
import { createRepos } from "../../src/db/repos.ts";
import type { SetupKey } from "../../src/db/types.ts";
import type { Payload } from "../../src/discord/gateway.ts";
import { createAudit } from "../../src/services/audit.ts";
import type { AppContext } from "../../src/services/context.ts";
import { FakeGateway } from "./fake-gateway.ts";

export const TEMPLATE_COLOR = 0x5865f2;
export const templatePosition = 10;
export const TEMPLATE_ROLE_ID = "100000000000000500";
export const ADMIN_ROLE_ID = "100000000000000600";
export const U1 = "100000000000000001";
export const U2 = "100000000000000002";
export const U3 = "100000000000000003";
export const A1 = "100000000000000011";
export const A2 = "100000000000000012";

const CHANNEL_KEYS = [
  "panelChannelId",
  "newsChannelId",
  "adminCategoryId",
  "adminChannelId",
  "logChannelId",
  "backupsChannelId",
] as const satisfies readonly SetupKey[];

export type TestContext = AppContext & {
  gateway: FakeGateway;
  logLines: string[];
  adminNotices: string[];
};

export function makeContext(
  overrides: { setup?: boolean; now?: Date; config?: Partial<Config> } = {},
): TestContext {
  const gateway = new FakeGateway({});
  const repos = createRepos(openDatabase(":memory:"));
  const config: Config = {
    token: "test-token",
    applicationId: "100000000000000100",
    guildId: gateway.guildId,
    adminRoleId: ADMIN_ROLE_ID,
    healthcheckUrl: null,
    databasePath: ":memory:",
    backupHourUtc: 4,
    ...overrides.config,
  };
  const now = overrides.now ?? new Date("2026-01-15T12:00:00Z");

  gateway.setBotTopPosition(templatePosition + 5);
  if (overrides.setup ?? true) {
    for (const name of STARTING_CATEGORIES) repos.categories.add(name);
    gateway.addRole({
      id: TEMPLATE_ROLE_ID,
      name: "Game role template",
      position: templatePosition,
      color: TEMPLATE_COLOR,
      mentionable: true,
    });
    repos.setup.set("templateRoleId", TEMPLATE_ROLE_ID);
    let next = 100000000000000700n;
    for (const key of CHANNEL_KEYS) {
      const id = (next++).toString();
      gateway.addChannel(id);
      repos.setup.set(key, id);
    }
  }

  const sentTo = (key: SetupKey): string[] => {
    const channelId = repos.setup.get(key);
    return (channelId ? (gateway.messages.get(channelId) ?? []) : []).map((m) =>
      String(m.payload.content ?? ""),
    );
  };

  return {
    config,
    repos,
    gateway,
    audit: createAudit(repos, gateway),
    now: () => new Date(now),
    get logLines() {
      return sentTo("logChannelId");
    },
    get adminNotices() {
      return sentTo("adminChannelId");
    },
  };
}

export function sentTo(ctx: TestContext, key: SetupKey): Payload[] {
  const channelId = ctx.repos.setup.get(key);
  return channelId ? (ctx.gateway.messages.get(channelId) ?? []).map((m) => m.payload) : [];
}

export function lastSend(ctx: TestContext): { channelId: string; payload: Payload } {
  const call = ctx.gateway.calls.findLast((c) => c.method === "send");
  if (!call) throw new Error("No message was sent");
  return { channelId: call.args[0] as string, payload: call.args[1] as Payload };
}
