import { DiscordAPIError } from "discord.js";
import { beforeEach, describe, expect, test } from "vitest";

import { DISCORD_ERROR } from "../discord/index.ts";
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
  fakeInteraction,
  makeContext,
  methods,
} from "../testing/index.ts";
import { lfgHandlers } from "./lfg.ts";
import { openMenus } from "./menus.ts";

import type { PermissionsString } from "discord.js";
import type { Call, TestContext } from "../testing/index.ts";
import type { Handler } from "./router.ts";

const handler = (name: keyof typeof lfgHandlers): Handler => defined(lfgHandlers[name], name);

const CH = "100000000000000900";
let ctx: TestContext;
let postId: string;
let gameId: number;

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
  gameId = game.id;
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

const THREAD = "100000000000000901";

const runLfg = (from: { channelId: string; permissions: PermissionsString[]; thread?: boolean }) =>
  handler("lfg")(
    ctx,
    fakeInteraction([], {
      type: "command",
      commandName: "lfg",
      strings: { game: String(gameId) },
      channelId: from.channelId,
      permissions: from.permissions,
      ...(from.thread === true ? { threadParentId: CH } : {}),
    }),
  );
const postsIn = (channelId: string) => ctx.gateway.messages.get(channelId)?.length ?? 0;

describe("where /lfg posts", () => {
  test("in a channel the member can post in, it posts there", async () => {
    const before = postsIn(CH);
    await runLfg({ channelId: CH, permissions: ["SendMessages"] });
    expect(postsIn(CH)).toBe(before + 1);
  });

  test("in a channel the member can't post in, it refuses and posts nothing", async () => {
    const before = ctx.gateway.calls.length;
    await expect(runLfg({ channelId: CH, permissions: [] })).rejects.toThrow(UserFacingError);
    expect(methods(ctx.gateway.calls.slice(before))).not.toContain("send");
  });

  test("in a thread, it goes by the member's thread permission, not the channel one", async () => {
    ctx.gateway.addChannel(THREAD);
    await expect(
      runLfg({ channelId: THREAD, permissions: ["SendMessages"], thread: true }),
    ).rejects.toThrow(UserFacingError);
    expect(postsIn(THREAD)).toBe(0);
    await runLfg({ channelId: THREAD, permissions: ["SendMessagesInThreads"], thread: true });
    expect(postsIn(THREAD)).toBe(1);
  });

  test("Discord refusing the bot access becomes a private explanation", async () => {
    for (const code of [DISCORD_ERROR.missingAccess, DISCORD_ERROR.missingPermissions]) {
      ctx.gateway.failNext(
        "send",
        new DiscordAPIError({ code, message: "x" }, code, 403, "POST", "/", {}),
      );
      await expect(runLfg({ channelId: CH, permissions: ["SendMessages"] })).rejects.toThrow(
        UserFacingError,
      );
    }
  });

  test("other failures are not disguised as a permission problem", async () => {
    ctx.gateway.failNext("send", new Error("boom"));
    const error: unknown = await runLfg({ channelId: CH, permissions: ["SendMessages"] }).catch(
      (e: unknown) => e,
    );
    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});
