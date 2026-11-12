import { beforeEach, describe, expect, test } from "vitest";

import { choicesToBits, encodeId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { addGame, previewUninstall } from "../services/index.ts";
import {
  A1,
  ADMIN_ROLE_ID,
  defined,
  deletedIds,
  fakeButton,
  fakeInteraction,
  makeContext,
} from "../testing/index.ts";
import { FIELD, uninstallPreviewView } from "../views/index.ts";
import { adminHandlers } from "./admin.ts";
import { openMenus } from "./menus.ts";
import { updateWith } from "./replies.ts";

import type { UninstallOption } from "../domain/index.ts";
import type { Call, TestContext } from "../testing/index.ts";
import type { Handler } from "./router.ts";

const handler = (name: keyof typeof adminHandlers): Handler => {
  const found = adminHandlers[name];
  if (found === undefined) throw new Error(`No handler ${name}`);
  return found;
};

beforeEach(() => openMenus.entries.clear());

const confirmButton = (calls: Call[], keep: UninstallOption[]) =>
  fakeButton(calls, {
    customId: encodeId({ kind: "uninstall-confirm", choices: choicesToBits(new Set(keep)) }),
    onMessage: "uninstall",
    roles: [ADMIN_ROLE_ID],
  });

test("the uninstall report, which carries the backup, stays when another menu opens", async () => {
  const ctx = await makeContext();
  const log: Call[] = [];
  const preview = fakeButton(log, { onMessage: "uninstall", roles: [ADMIN_ROLE_ID] });
  await updateWith(preview, async () =>
    uninstallPreviewView(await previewUninstall(ctx, null), new Set()),
  );
  const confirm = confirmButton(log, []);
  await handler("uninstall-confirm")(ctx, confirm);
  openMenus.open(confirm.user.id, {
    messageId: "next-menu",
    expiresAt: Date.now() + 60_000,
    close: async () => {},
  });
  expect(deletedIds(log)).toEqual([]);
});

const leftServer = (ctx: TestContext) =>
  ctx.gateway.calls.some((c) => c.method === "clearCommands" || c.method === "leave");

describe("uninstall-confirm and leaving", () => {
  test("with Leave ticked, the bot leaves only after the report and backup arrive", async () => {
    const ctx = await makeContext();
    const confirm = confirmButton([], ["leave"]);
    let leftBeforeDelivery: boolean | undefined;
    Object.assign(confirm, {
      editReply: async () => {
        leftBeforeDelivery = leftServer(ctx);
      },
    });
    await handler("uninstall-confirm")(ctx, confirm);
    expect(leftBeforeDelivery).toBe(false);
    expect(ctx.gateway.calls.map((c) => c.method).slice(-2)).toEqual(["clearCommands", "leave"]);
  });

  test("if the report can't be delivered, the bot stays and keeps its data", async () => {
    const ctx = await makeContext();
    const confirm = confirmButton([], ["leave"]);
    Object.assign(confirm, {
      editReply: async () => {
        throw new Error("Request entity too large");
      },
    });
    await expect(handler("uninstall-confirm")(ctx, confirm)).rejects.toThrow(UserFacingError);
    expect(leftServer(ctx)).toBe(false);
    expect(await ctx.repos.setup.get("logChannelId")).toBeDefined();
  });

  test("without Leave ticked, the bot stays", async () => {
    const ctx = await makeContext();
    await handler("uninstall-confirm")(ctx, confirmButton([], []));
    expect(leftServer(ctx)).toBe(false);
  });
});

async function withGame() {
  const ctx = await makeContext();
  const category = defined((await ctx.repos.categories.list())[0]);
  const game = await addGame(ctx, {
    name: "Valheim",
    categoryId: category.id,
    aliases: "vh, viking",
    actorId: A1,
  });
  const submit = (fields: Record<string, string | string[]>) =>
    handler("game-edit-modal")(
      ctx,
      fakeInteraction([], {
        type: "modal",
        customId: encodeId({ kind: "game-edit-modal", gameId: game.id }),
        roles: [ADMIN_ROLE_ID],
        fields: { [FIELD.category]: [String(category.id)], ...fields },
      }),
    );
  const stored = async () => defined(await ctx.repos.games.get(game.id));
  return { submit, stored };
}

describe("game-edit-modal", () => {
  test("a form without the aliases field, as when they were too long to prefill, keeps them", async () => {
    const { submit, stored } = await withGame();
    await submit({ [FIELD.name]: "Valheim 2" });
    expect(await stored()).toMatchObject({ name: "Valheim 2", aliases: ["vh", "viking"] });
  });

  test("an emptied aliases field clears them", async () => {
    const { submit, stored } = await withGame();
    await submit({ [FIELD.name]: "Valheim", [FIELD.aliases]: "" });
    expect((await stored()).aliases).toEqual([]);
  });
});
