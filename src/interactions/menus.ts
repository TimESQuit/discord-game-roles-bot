import { DISCORD_ERROR, isDiscordError } from "../discord/index.ts";

/** An interaction's token, and with it the right to delete its private reply, lasts 15 minutes. */
export const TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/** How long a one-line notice stays up before it closes itself. */
export const NOTICE_LIFETIME_MS = 7 * 1000;

/**
 * Deletes one private message through an interaction's webhook. It should hold only that webhook
 * (application ID, token and the shared client), not the interaction, so what is kept stays small.
 */
export type Close = () => Promise<unknown>;

/** Deleting a message the person already dismissed, or whose token has run out, fails with these. */
const GONE = [
  DISCORD_ERROR.unknownMessage,
  DISCORD_ERROR.unknownWebhook,
  DISCORD_ERROR.invalidWebhookToken,
];

/** Runs `close`, counting a message that is already gone as closed. */
export async function closeIfPresent(close: Close): Promise<void> {
  try {
    await close();
  } catch (error) {
    if (!isDiscordError(error, ...GONE)) throw error;
  }
}

/** Closes without failing the caller: a cleanup that goes wrong is only logged. */
const closeQuietly = (close: Close): Promise<void> =>
  closeIfPresent(close).catch((error: unknown) => {
    console.error("Could not close a private message", error);
  });

/** Notices waiting for their timer. Kept so shutdown can close them: the timers die with the process. */
const pendingNotices = new Map<NodeJS.Timeout, Close>();

/** Closes a notice once its lifetime is up. The timer does not keep the process alive. */
export function closeSoon(close: Close): void {
  const timer = setTimeout(() => {
    pendingNotices.delete(timer);
    void closeQuietly(close);
  }, NOTICE_LIFETIME_MS);
  timer.unref();
  pendingNotices.set(timer, close);
}

/** On shutdown: closes every notice still up now, since its timer won't survive the restart. */
export async function closeNoticesNow(): Promise<void> {
  const closes = [...pendingNotices].map(([timer, close]) => {
    clearTimeout(timer);
    return closeQuietly(close);
  });
  pendingNotices.clear();
  await Promise.all(closes);
}

export type OpenMenu = {
  messageId: string;
  /** Deletes the menu through the latest interaction on it. */
  close: Close;
  /** When that interaction's token runs out, after which the menu can't be deleted. */
  expiresAt: number;
};

/** Counts menus opened, so work that started before a newer menu opened can tell it is stale. */
let opened = 0;

/**
 * Each person's open menu, so opening another one closes it and they see one at a time.
 * Menus whose token has run out are swept on every open: they can no longer be closed.
 */
export const openMenus = {
  entries: new Map<string, OpenMenu & { order: number }>(),
  /** Read before slow work that may open a menu, and pass to `open` once it is shown. */
  ticket(): number {
    return opened;
  },
  /**
   * Makes `menu` the person's open menu and closes the one it replaces, without waiting for the
   * deletion. `since` is the `ticket()` from when the work that built `menu` began: if the person
   * opened another menu after that, `menu` is the stale one, so it closes and the newer one stays.
   */
  open(userId: string, menu: OpenMenu, since = opened, now = Date.now()): void {
    const current = this.entries.get(userId);
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
    if (current?.messageId === menu.messageId) {
      // The same message again, through a newer interaction: keep its place, refresh its token.
      this.entries.set(userId, { ...menu, order: current.order });
      return;
    }
    if (current !== undefined && current.order > since) {
      void closeQuietly(menu.close);
      return;
    }
    opened += 1;
    this.entries.set(userId, { ...menu, order: opened });
    if (current !== undefined && current.expiresAt > now) void closeQuietly(current.close);
  },
  /** Stops tracking a message that was closed, became a notice, or has to stay. */
  forget(userId: string, messageId: string): void {
    if (this.entries.get(userId)?.messageId === messageId) this.entries.delete(userId);
  },
};
