import { HEARTBEAT_INTERVAL_MS } from "./constants.ts";
import { adminHandlers } from "./interactions/admin.ts";
import { lfgHandlers } from "./interactions/lfg.ts";
import { memberHandlers } from "./interactions/member.ts";
import type { Handlers } from "./interactions/router.ts";
import { suggestHandlers } from "./interactions/suggest.ts";
import { scheduleNightlyBackups } from "./services/backup.ts";
import type { AppContext } from "./services/context.ts";
import { startHeartbeat } from "./services/heartbeat.ts";

/** Merges the handler maps. A key defined twice is a programming error, so it throws. */
export function buildHandlers(
  maps: readonly Handlers[] = [memberHandlers, suggestHandlers, lfgHandlers, adminHandlers],
): Handlers {
  const merged: Handlers = {};
  for (const map of maps) {
    for (const [name, handler] of Object.entries(map)) {
      if (name in merged) throw new Error(`Handler "${name}" is defined more than once`);
      Object.assign(merged, { [name]: handler });
    }
  }
  return merged;
}

export interface ReadyDeps {
  registerCommands: () => Promise<void>;
  fetchMembers: () => Promise<void>;
  isConnected: () => boolean;
  version: string;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs the startup steps and returns a function that stops the backup and heartbeat timers. */
export async function onReady(ctx: AppContext, deps: ReadyDeps): Promise<() => void> {
  try {
    await deps.registerCommands();
  } catch (error) {
    console.error("Registering commands failed", error);
    await ctx.audit.notifyAdmins(`Registering commands failed: ${messageOf(error)}`);
  }
  try {
    await deps.fetchMembers();
  } catch (error) {
    console.error("Fetching members failed", error);
    await ctx.audit.notifyAdmins(`Fetching guild members failed: ${messageOf(error)}`);
  }
  await ctx.audit.notifyAdmins(`Bot started (version ${deps.version}).`);

  const stopBackups = scheduleNightlyBackups(ctx, ctx.db);
  const stopHeartbeat = startHeartbeat({
    url: ctx.config.healthcheckUrl,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    isConnected: deps.isConnected,
  });
  return () => {
    stopBackups();
    stopHeartbeat();
  };
}
