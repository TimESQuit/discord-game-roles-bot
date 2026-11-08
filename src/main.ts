import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client, Events, GatewayIntentBits, MessageFlags, REST } from "discord.js";

import { buildHandlers, createErrorReporter, createShutdown, onReady } from "./app.ts";
import { loadConfig } from "./config.ts";
import { closeDatabase, openDatabase, createRepos } from "./db/index.ts";
import { createDiscordGateway } from "./discord/index.ts";
import { registerCommands, handleInteraction } from "./interactions/index.ts";
import { createAudit } from "./services/index.ts";

import type { Interaction } from "discord.js";
import type { AppContext } from "./services/index.ts";

function readVersion(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (
    typeof pkg !== "object" ||
    pkg === null ||
    !("version" in pkg) ||
    typeof pkg.version !== "string"
  ) {
    throw new Error("package.json has no version");
  }
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
let membersReady = false;

const report = createErrorReporter(() => {
  const audit = ctx?.audit;
  return audit ? (text) => audit.notifyAdmins(text) : undefined;
});
const shutdown = createShutdown({
  stopTimers: () => stopTimers,
  destroyClient: () => client.destroy(),
  closeDb: () => closeDatabase(db),
  exit: (code) => process.exit(code),
});

process.on("unhandledRejection", (reason) => void report("Unhandled rejection", reason));
client.on(Events.Error, (error) => void report("Discord client error", error));

async function tellStarting(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) await interaction.respond([]);
    else if (interaction.isRepliable())
      await interaction.reply({
        content: "The bot is still starting. Try again in a moment.",
        flags: MessageFlags.Ephemeral,
      });
  } catch (error) {
    console.error("Could not answer an interaction during startup", error);
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  if (ctx === undefined || shutdown.isStopping()) return;
  if (interaction.guildId !== config.guildId) return;
  if (!membersReady) {
    void tellStarting(interaction);
    return;
  }
  void handleInteraction(ctx, handlers, interaction).catch((error) =>
    report("Interaction failed", error),
  );
});

client.once(Events.ClientReady, (ready) => {
  const repos = createRepos(db.kysely);
  const gateway = createDiscordGateway(ready, config.guildId);
  const readyCtx: AppContext = {
    config,
    db,
    repos,
    gateway,
    audit: createAudit(repos, gateway),
    now: () => new Date(),
  };
  ctx = readyCtx;
  console.log("Logged in to Discord.");
  const rest = new REST().setToken(config.token);
  void onReady(readyCtx, {
    registerCommands: () => registerCommands(rest, config),
    fetchMembers: async () => {
      const guild = ready.guilds.cache.get(config.guildId);
      if (!guild) throw new Error("The configured server is not available");
      await guild.members.fetch();
    },
    onMembersReady: () => {
      membersReady = true;
    },
    isConnected: () => client.isReady(),
    isStopping: () => shutdown.isStopping(),
    version,
  })
    .then((stop) => {
      stopTimers = stop;
      if (shutdown.isStopping()) stop();
    })
    .catch((error) => report("Startup failed", error));
});

process.on("SIGTERM", () => void shutdown.run());
process.on("SIGINT", () => void shutdown.run());

try {
  await client.login(config.token);
} catch (error) {
  console.error(
    'Could not log in to Discord. Check DISCORD_TOKEN and the network; "Disallowed intents" means Server Members is off in the Developer Portal.',
    error instanceof Error ? error.message : String(error),
  );
  await closeDatabase(db).catch(() => {});
  process.exit(1);
}
