import { HEARTBEAT_INTERVAL_MS } from "./constants.ts";
import {
  adminHandlers,
  lfgHandlers,
  memberHandlers,
  suggestHandlers,
} from "./interactions/index.ts";
import { scheduleNightlyBackups, startHeartbeat } from "./services/index.ts";

import type { Handlers } from "./interactions/index.ts";
import type { AppContext } from "./services/index.ts";

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
  /** True once shutdown has begun; startup then skips the timers. */
  isStopping: () => boolean;
  /** Called once the member fetch has finished (also when it failed). */
  onMembersReady?: () => void;
  version: string;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs the startup steps and returns a function that stops the backup and heartbeat timers. */
export async function onReady(ctx: AppContext, deps: ReadyDeps): Promise<() => void> {
  try {
    await deps.fetchMembers();
  } catch (error) {
    console.error("Fetching members failed", error);
    await ctx.audit.notifyAdmins(`Fetching guild members failed: ${messageOf(error)}`);
  }
  deps.onMembersReady?.();
  try {
    await deps.registerCommands();
  } catch (error) {
    console.error("Registering commands failed", error);
    await ctx.audit.notifyAdmins(`Registering commands failed: ${messageOf(error)}`);
  }
  await ctx.audit.notifyAdmins(`Bot started (version ${deps.version}).`);

  if (deps.isStopping()) return () => {};
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

/** Reports a problem to the console and the admins. A failing or re-entrant notify cannot loop. */
export function createErrorReporter(
  getNotify: () => ((text: string) => Promise<void>) | undefined,
): (label: string, error: unknown) => Promise<void> {
  let reporting = false;
  return async (label, error) => {
    console.error(label, error);
    const notify = getNotify();
    if (reporting || notify === undefined) return;
    reporting = true;
    try {
      await notify(`${label}: ${messageOf(error)}`);
    } catch (notifyError) {
      console.error("Could not notify admins", notifyError);
    } finally {
      reporting = false;
    }
  };
}

export interface ShutdownDeps {
  stopTimers: () => (() => void) | undefined;
  destroyClient: () => Promise<void>;
  closeDb: () => Promise<void>;
  exit: (code: number) => void;
}

/** Stops everything once. Each step is isolated so one failure cannot prevent the exit. */
export function createShutdown(deps: ShutdownDeps): {
  run: () => Promise<void>;
  isStopping: () => boolean;
} {
  let stopping = false;
  return {
    isStopping: () => stopping,
    run: async () => {
      if (stopping) return;
      stopping = true;
      let failed = false;
      const step = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
        try {
          await fn();
        } catch (error) {
          failed = true;
          console.error(`Shutdown step failed: ${name}`, error);
        }
      };
      try {
        await step("timers", () => deps.stopTimers()?.());
        await step("client", deps.destroyClient);
        await step("database", deps.closeDb);
      } finally {
        deps.exit(failed ? 1 : 0);
      }
    },
  };
}
