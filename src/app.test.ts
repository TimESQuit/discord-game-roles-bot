import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildHandlers, createErrorReporter, createShutdown, onReady } from "./app.ts";
import { HANDLER_NAMES } from "./interactions/index.ts";
import { formatAuditLine } from "./services/index.ts";
import { makeContext } from "./testing/index.ts";

import type { ReadyDeps } from "./app.ts";

const noop = async (): Promise<void> => {};
const started = formatAuditLine({ kind: "started", version: "1.2.3" });

const deps = (calls: string[], over: Partial<ReadyDeps> = {}): ReadyDeps => ({
  registerCommands: async () => {
    calls.push("register");
  },
  fetchMembers: async () => {
    calls.push("fetch");
  },
  isStopping: () => false,
  version: "1.2.3",
  ...over,
});

const makeShutdown = (over: Partial<Parameters<typeof createShutdown>[0]> = {}) => {
  const calls: string[] = [];
  const exit = vi.fn<(code: number) => void>();
  const shutdown = createShutdown({
    stopTimers: () => () => calls.push("timers"),
    destroyClient: async () => {
      calls.push("destroy");
    },
    closeDb: async () => {
      calls.push("db");
    },
    exit,
    ...over,
  });
  return { calls, exit, shutdown };
};

describe("buildHandlers", () => {
  test("every handler name the router can return is implemented", () => {
    const handlers = buildHandlers();
    const missing = HANDLER_NAMES.filter((name) => typeof handlers[name] !== "function");
    expect(missing).toEqual([]);
  });

  test("a duplicate key across handler maps throws", () => {
    expect(() => buildHandlers([{ cancel: noop }, { cancel: noop }])).toThrow("cancel");
  });
});

describe("onReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("fetches members, registers, then logs the started line, not an admin notice", async () => {
    const ctx = await makeContext();
    const calls: string[] = [];
    const stop = await onReady(ctx, deps(calls));
    expect(calls).toEqual(["fetch", "register"]);
    expect(ctx.logLines).toEqual([started]);
    expect(ctx.errorReports).toEqual([]);
    stop();
  });

  test("a failing registerCommands is reported and the timers still start", async () => {
    const ctx = await makeContext();
    const calls: string[] = [];
    const stop = await onReady(
      ctx,
      deps(calls, {
        registerCommands: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(calls).toEqual(["fetch"]);
    expect(ctx.errorReports).toEqual([expect.stringContaining("boom")]);
    expect(ctx.logLines).toEqual([started]);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    stop();
  });

  test("stop cancels the nightly backup", async () => {
    const ctx = await makeContext();
    vi.spyOn(ctx.audit, "reportError").mockResolvedValue();
    const stop = await onReady(ctx, deps([]));
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("onReady and shutdown", () => {
  test("members-ready callback fires after the member fetch, before registering", async () => {
    const ctx = await makeContext();
    vi.spyOn(ctx.audit, "reportError").mockResolvedValue();
    const calls: string[] = [];
    const stop = await onReady(ctx, {
      ...deps(calls),
      onMembersReady: () => calls.push("members-ready"),
    });
    expect(calls).toEqual(["fetch", "members-ready", "register"]);
    stop();
  });

  test("no timers start when shutdown began during startup", async () => {
    vi.useFakeTimers();
    const ctx = await makeContext();
    vi.spyOn(ctx.audit, "reportError").mockResolvedValue();
    let stopping = false;
    const gate = Promise.withResolvers<void>();
    const pending = onReady(ctx, {
      ...deps([]),
      registerCommands: () => gate.promise,
      isStopping: () => stopping,
    });
    stopping = true;
    gate.resolve();
    const stop = await pending;
    expect(vi.getTimerCount()).toBe(0);
    stop();
    vi.useRealTimers();
  });

  test("shutdown stops timers, destroys, closes, exits 0", async () => {
    const { calls, exit, shutdown } = makeShutdown();
    await shutdown.run();
    expect(calls).toEqual(["timers", "destroy", "db"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(shutdown.isStopping()).toBe(true);
  });

  test("a rejecting destroy still closes the database and exits 1", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, exit, shutdown } = makeShutdown({
      destroyClient: async () => {
        throw new Error("nope");
      },
    });
    await shutdown.run();
    expect(calls).toContain("db");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  test("a second signal is a no-op", async () => {
    const { exit, shutdown } = makeShutdown();
    await Promise.all([shutdown.run(), shutdown.run()]);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  test("a signal before ready works (no stop function yet)", async () => {
    const { exit, shutdown } = makeShutdown({ stopTimers: () => undefined });
    await shutdown.run();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  test("the error reporter notifies once and cannot loop", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = vi.fn<(text: string) => Promise<void>>();
    const report = createErrorReporter(() => notify);
    notify.mockImplementationOnce(async () => {
      await report("inner", new Error("again"));
      throw new Error("notify broke");
    });
    await report("Oops", new Error("bad"));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Oops: bad");
    await report("Later", "x");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test("the error reporter only logs before a notifier exists", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(createErrorReporter(() => undefined)("Early", new Error("x"))).resolves.toBe(
      undefined,
    );
  });
});
