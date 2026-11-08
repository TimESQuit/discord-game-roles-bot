import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKUP_RETENTION_DAYS, MESSAGES } from "../constants.ts";
import { msUntilNextRun, selectExpiredBackups } from "../domain/index.ts";
import { messageOf, UserFacingError } from "../errors.ts";
import { silent } from "../views/index.ts";

import type { Db } from "../db/index.ts";
import type { AppContext } from "./context.ts";

const pad = (n: number): string => String(n).padStart(2, "0");

function backupFileName(now: Date): string {
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return `game-roles-${date}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}.sqlite`;
}

/** Snapshots the database into #game-roles-backups, then prunes the bot's own backup posts older than 30 days. */
export async function runBackup(
  ctx: AppContext,
  db: Db,
  actorId: string | null,
): Promise<{ file: string; pruned: number }> {
  const channelId = await ctx.repos.setup.get("backupsChannelId");
  if (channelId === undefined) throw new UserFacingError(MESSAGES.setupFirst);

  const now = ctx.now();
  const name = backupFileName(now);
  const folder = await mkdtemp(join(tmpdir(), "game-roles-backup-"));
  try {
    const path = join(folder, name);
    await db.sqlite.backup(path);
    const attachment = await readFile(path);
    await ctx.gateway.send(
      channelId,
      silent({
        content: actorId === null ? "Nightly backup" : `Backup requested by <@${actorId}>`,
        files: [{ attachment, name }],
        allowedMentions: { parse: [] },
      }),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  let pruned = 0;
  try {
    const expired = selectExpiredBackups(
      await ctx.gateway.ownMessages(channelId, 100),
      now,
      BACKUP_RETENTION_DAYS,
    );
    for (const id of expired) {
      await ctx.gateway.deleteMessage(channelId, id);
      pruned += 1;
    }
  } catch (error) {
    await ctx.audit.notifyAdmins(
      `Backup saved, but pruning old backups failed: ${messageOf(error)}`,
    );
  }

  await ctx.audit.log({ kind: "backup", userId: actorId, file: name });
  return { file: name, pruned };
}

/** Runs a backup every day at `config.backupHourUtc`. Returns a function that cancels the pending run. */
export function scheduleNightlyBackups(ctx: AppContext, db: Db): () => void {
  let timer: NodeJS.Timeout | undefined;
  let cancelled = false;

  const arm = (): void => {
    timer = setTimeout(
      () => {
        void (async () => {
          try {
            await runBackup(ctx, db, null);
          } catch (error) {
            await ctx.audit.notifyAdmins(`Nightly backup failed: ${messageOf(error)}`);
          } finally {
            if (!cancelled) arm();
          }
        })();
      },
      msUntilNextRun(ctx.now(), ctx.config.backupHourUtc),
    );
  };
  arm();

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
