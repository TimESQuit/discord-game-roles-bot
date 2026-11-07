import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildHandlers, onReady, type ReadyDeps } from "../src/app.ts";
import { HANDLER_NAMES } from "../src/interactions/router.ts";
import { makeContext } from "./fakes/context.ts";

describe("buildHandlers", () => {
  test("every handler name the router can return is implemented", () => {
    const handlers = buildHandlers();
    const missing = HANDLER_NAMES.filter((name) => typeof handlers[name] !== "function");
    expect(missing).toEqual([]);
  });

  test("a duplicate key across handler maps throws", () => {
    const noop = async (): Promise<void> => {};
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

  const deps = (calls: string[], over: Partial<ReadyDeps> = {}): ReadyDeps => ({
    registerCommands: async () => {
      calls.push("register");
    },
    fetchMembers: async () => {
      calls.push("fetch");
    },
    isConnected: () => true,
    version: "1.2.3",
    ...over,
  });

  test("registers, fetches members, then posts the started notice", async () => {
    const ctx = await makeContext();
    const calls: string[] = [];
    const notify = vi.spyOn(ctx.audit, "notifyAdmins").mockImplementation(async (t) => {
      calls.push(`notify:${t}`);
    });
    const stop = await onReady(ctx, deps(calls));
    expect(calls).toEqual(["register", "fetch", "notify:Bot started (version 1.2.3)."]);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  test("a failing registerCommands is reported and the timers still start", async () => {
    const ctx = await makeContext({ config: { healthcheckUrl: "https://example.test/ping" } });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const calls: string[] = [];
    const notices: string[] = [];
    vi.spyOn(ctx.audit, "notifyAdmins").mockImplementation(async (t) => {
      notices.push(t);
    });
    const stop = await onReady(
      ctx,
      deps(calls, {
        registerCommands: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(calls).toEqual(["fetch"]);
    expect(notices[0]).toContain("boom");
    expect(notices.at(-1)).toBe("Bot started (version 1.2.3).");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
    vi.unstubAllGlobals();
  });

  test("stop cancels the heartbeat and the nightly backup", async () => {
    const ctx = await makeContext({ config: { healthcheckUrl: "https://example.test/ping" } });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(ctx.audit, "notifyAdmins").mockResolvedValue();
    const stop = await onReady(ctx, deps([]));
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.unstubAllGlobals();
  });
});
