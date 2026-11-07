import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startHeartbeat } from "./heartbeat.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ok = () => new Response(null, { status: 200 });

test("heartbeat pings only while connected; no URL → never", async () => {
  const fetchFn = vi.fn<typeof fetch>(async () => ok());
  let connected = true;
  const stop = startHeartbeat({
    url: "https://hc.example/ping",
    intervalMs: 1000,
    isConnected: () => connected,
    fetch: fetchFn,
  });
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(fetchFn.mock.calls[0]![0]).toBe("https://hc.example/ping");
  connected = false;
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  connected = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchFn).toHaveBeenCalledTimes(2);

  const none = vi.fn<typeof fetch>(async () => ok());
  const stopNone = startHeartbeat({
    url: null,
    intervalMs: 1000,
    isConnected: () => true,
    fetch: none,
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(none).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  stopNone();
});

test("heartbeat survives fetch rejecting and non-2xx", async () => {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValue(ok());
  const stop = startHeartbeat({
    url: "https://hc.example/ping",
    intervalMs: 1000,
    isConnected: () => true,
    fetch: fetchFn,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchFn).toHaveBeenCalledTimes(3);
  expect(console.warn).toHaveBeenCalledTimes(2);
  stop();
});
