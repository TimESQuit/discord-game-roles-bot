import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client, Events, GatewayIntentBits, REST } from "discord.js";
import { buildHandlers, onReady } from "./app.ts";
import { loadConfig } from "./config.ts";
import { closeDatabase, openDatabase } from "./db/database.ts";
import { createRepos } from "./db/repos/index.ts";
import { createDiscordGateway } from "./discord/discord-gateway.ts";
import { registerCommands } from "./interactions/commands.ts";
import { handleInteraction } from "./interactions/router.ts";
import { createAudit, type Audit } from "./services/audit.ts";
import type { AppContext } from "./services/context.ts";

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  const sha = process.env["GIT_SHA"];
  return sha ? `${pkg.version}+${sha.slice(0, 7)}` : pkg.version;
}

const config = loadConfig(process.env);
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openDatabase(config.databasePath);
const handlers = buildHandlers();
const version = readVersion();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  allowedMentions: { parse: [] },
});

let ctx: AppContext | undefined;
let stopTimers: (() => void) | undefined;
let reporting = false;

/** Logs the problem and tells the admins. A failure to notify is only logged, so it cannot loop. */
async function report(label: string, error: unknown): Promise<void> {
  console.error(label, error);
  if (reporting || ctx === undefined) return;
  reporting = true;
  try {
    const audit: Audit = ctx.audit;
    const reason = error instanceof Error ? error.message : String(error);
    await audit.notifyAdmins(`${label}: ${reason}`);
  } catch (notifyError) {
    console.error("Could not notify admins", notifyError);
  } finally {
    reporting = false;
  }
}

process.on("unhandledRejection", (reason) => void report("Unhandled rejection", reason));
client.on(Events.Error, (error) => void report("Discord client error", error));

client.on(Events.InteractionCreate, (interaction) => {
  if (ctx === undefined) return;
  if (interaction.guildId !== config.guildId) return;
  void handleInteraction(ctx, handlers, interaction).catch((error) =>
    report("Interaction failed", error),
  );
});

client.once(Events.ClientReady, (ready) => {
  const repos = createRepos(db.kysely);
  const gateway = createDiscordGateway(ready, config.guildId);
  ctx = {
    config,
    db,
    repos,
    gateway,
    audit: createAudit(repos, gateway),
    now: () => new Date(),
  };
  console.log("Logged in to Discord.");
  const rest = new REST().setToken(config.token);
  void onReady(ctx, {
    registerCommands: () => registerCommands(rest, config),
    fetchMembers: async () => {
      const guild = ready.guilds.cache.get(config.guildId);
      if (!guild) throw new Error("The configured server is not available");
      await guild.members.fetch();
    },
    isConnected: () => client.isReady(),
    version,
  })
    .then((stop) => {
      stopTimers = stop;
    })
    .catch((error) => report("Startup failed", error));
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopTimers?.();
  await client.destroy();
  await closeDatabase(db);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await client.login(config.token);
