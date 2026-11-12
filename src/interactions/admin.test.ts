import { beforeEach, expect, test } from "vitest";

import { encodeId } from "../domain/index.ts";
import { previewUninstall } from "../services/index.ts";
import { ADMIN_ROLE_ID, deletedIds, fakeButton, makeContext } from "../testing/index.ts";
import { uninstallPreviewView } from "../views/index.ts";
import { adminHandlers } from "./admin.ts";
import { openMenus } from "./menus.ts";
import { updateWith } from "./replies.ts";

import type { Handler } from "./router.ts";

const handler = (name: keyof typeof adminHandlers): Handler => {
  const found = adminHandlers[name];
  if (found === undefined) throw new Error(`No handler ${name}`);
  return found;
};

beforeEach(() => openMenus.entries.clear());

test("the uninstall report, which carries the backup, stays when another menu opens", async () => {
  const ctx = await makeContext();
  const log: string[] = [];
  const preview = fakeButton(log, { onMessage: "uninstall", roles: [ADMIN_ROLE_ID] });
  await updateWith(preview, async () =>
    uninstallPreviewView(await previewUninstall(ctx, null), new Set()),
  );
  const confirm = fakeButton(log, {
    customId: encodeId({ kind: "uninstall-confirm", choices: 0 }),
    onMessage: "uninstall",
    roles: [ADMIN_ROLE_ID],
  });
  await handler("uninstall-confirm")(ctx, confirm);
  await openMenus.open(confirm.user.id, {
    messageId: "next-menu",
    expiresAt: Date.now() + 60_000,
    close: async () => {},
  });
  expect(deletedIds(log)).toEqual([]);
});
