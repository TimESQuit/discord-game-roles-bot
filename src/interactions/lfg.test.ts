import { beforeEach, expect, test } from "vitest";

import { encodeId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { addGame, createLfgPost } from "../services/index.ts";
import {
  ADMIN_ROLE_ID,
  A1,
  FAKE_USER_ID,
  U2,
  defined,
  fakeButton,
  makeContext,
  methods,
} from "../testing/index.ts";
import { lfgHandlers } from "./lfg.ts";
import { openMenus } from "./menus.ts";

import type { Call, TestContext } from "../testing/index.ts";
import type { Handler } from "./router.ts";

const handler = (name: keyof typeof lfgHandlers): Handler => defined(lfgHandlers[name], name);

const CH = "100000000000000900";
let ctx: TestContext;
let postId: string;

beforeEach(async () => {
  openMenus.entries.clear();
  ctx = await makeContext();
  const cats = await ctx.repos.categories.list();
  const game = await addGame(ctx, {
    name: "Valheim",
    categoryId: defined(cats[1]).id,
    aliases: "",
    actorId: A1,
  });
  ctx.gateway.addChannel(CH);
  // Started by someone other than the person clicking in these tests.
  postId = await createLfgPost(ctx, {
    authorId: U2,
    gameId: game.id,
    when: null,
    note: null,
    channelId: CH,
  });
});

const manage = (calls: Call[], roles: string[] = []) =>
  handler("lfg-manage")(
    ctx,
    fakeButton(calls, {
      customId: encodeId({ kind: "lfg-manage" }),
      onMessage: postId,
      ephemeral: false,
      roles,
    }),
  );

test("Manage refuses someone who neither started the post nor is an admin", async () => {
  const calls: Call[] = [];
  await expect(manage(calls)).rejects.toThrow(UserFacingError);
  expect(methods(calls)).toEqual([]);
});

test("an admin's Manage opens the private menu for that post", async () => {
  const calls: Call[] = [];
  await manage(calls, [ADMIN_ROLE_ID]);
  const reply = calls.find((c) => c.method === "reply");
  expect(JSON.stringify(reply?.arg)).toContain(encodeId({ kind: "lfg-finish", messageId: postId }));
});

test("Finish in the menu closes the post and turns the menu into a notice", async () => {
  const calls: Call[] = [];
  await handler("lfg-finish")(
    ctx,
    fakeButton(calls, {
      customId: encodeId({ kind: "lfg-finish", messageId: postId }),
      roles: [ADMIN_ROLE_ID],
    }),
  );
  expect(await ctx.repos.lfg.get(postId)).toMatchObject({
    status: "finished",
    closedBy: FAKE_USER_ID,
  });
  expect(methods(calls)).toEqual(["deferUpdate", "editReply"]);
});

test("Cancel post from a stranger's stale menu is refused and leaves the post open", async () => {
  const calls: Call[] = [];
  await expect(
    handler("lfg-cancel")(
      ctx,
      fakeButton(calls, { customId: encodeId({ kind: "lfg-cancel", messageId: postId }) }),
    ),
  ).rejects.toThrow(UserFacingError);
  expect((await ctx.repos.lfg.get(postId))?.status).toBe("open");
});
