import { UserFacingError } from "../errors.ts";

/** Wraps `fn` so a call made while another is still running fails with `busyMessage`. */
export function exclusive<Args extends unknown[], R>(
  busyMessage: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  let running = false;
  return async (...args) => {
    if (running) throw new UserFacingError(busyMessage);
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
}

/** Runs tasks for the same key one after another; the map entry goes away when the chain drains. */
const chains = new Map<string, Promise<unknown>>();
export function serialised<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
