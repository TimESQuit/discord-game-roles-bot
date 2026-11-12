import { DISCORD_ERROR, isDiscordError } from "../discord/index.ts";

/** An interaction's token, and with it the right to delete its private reply, lasts 15 minutes. */
export const TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/** How long a one-line notice stays up before it closes itself. */
export const NOTICE_LIFETIME_MS = 20 * 1000;

/** Deletes one private message through an interaction that answered it. */
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

/** Closes a notice once its lifetime is up. The timer does not keep the process alive. */
export function closeSoon(close: Close): void {
  setTimeout(() => void closeQuietly(close), NOTICE_LIFETIME_MS).unref();
}

export type OpenMenu = {
  messageId: string;
  /** Deletes the menu through the latest interaction on it. */
  close: Close;
  /** When that interaction's token runs out, after which the menu can't be deleted. */
  expiresAt: number;
};

/**
 * Each person's open menu, so opening another one closes it and they see one at a time.
 * Menus whose token has run out are swept on every open: they can no longer be closed.
 */
export const openMenus = {
  entries: new Map<string, OpenMenu>(),
  /** Makes `menu` the person's open menu, closing the one it replaces. */
  async open(userId: string, menu: OpenMenu, now = Date.now()): Promise<void> {
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
    const previous = this.entries.get(userId);
    this.entries.set(userId, menu);
    if (previous !== undefined && previous.messageId !== menu.messageId) {
      await closeQuietly(previous.close);
    }
  },
  /** Stops tracking a message that was closed, became a notice, or has to stay. */
  forget(userId: string, messageId: string): void {
    if (this.entries.get(userId)?.messageId === messageId) this.entries.delete(userId);
  },
};
