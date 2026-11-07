export interface HeartbeatOptions {
  url: string | null;
  intervalMs: number;
  isConnected: () => boolean;
  fetch?: typeof fetch;
}

/** Pings a healthchecks.io URL while connected to Discord. Failures are logged, never thrown. */
export function startHeartbeat(opts: HeartbeatOptions): () => void {
  const { url, intervalMs, isConnected } = opts;
  if (url === null) return () => {};
  const doFetch = opts.fetch ?? fetch;

  const ping = async (): Promise<void> => {
    if (!isConnected()) return;
    try {
      const response = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) console.warn(`Heartbeat returned HTTP ${response.status}`);
    } catch (error) {
      console.warn("Heartbeat failed", error);
    }
  };

  void ping();
  const timer = setInterval(() => void ping(), intervalMs);
  return () => clearInterval(timer);
}
