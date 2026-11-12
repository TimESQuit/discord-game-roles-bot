import { beforeEach, describe, expect, test, vi } from "vitest";

import { MESSAGES } from "../constants.ts";
import { UserFacingError } from "../errors.ts";
import {
  A1,
  A2,
  buttonKinds,
  defined,
  lastEdit,
  lastSend,
  makeContext,
  textOf,
  U1,
  U2,
  U3,
} from "../testing/index.ts";
import { addGame, removeGame } from "./games.ts";
import {
  LFG_REFUSALS,
  closeLfgPost,
  createLfgPost,
  lfgChannel,
  lfgPostToManage,
  respondToLfg,
  toggleRoleFromLfg,
} from "./lfg.ts";

import type { Game } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { TestContext } from "../testing/index.ts";

const CH = "100000000000000900";
let ctx: TestContext;
let valheim: Game;
let id: string;

beforeEach(async () => {
  ctx = await makeContext();
  const cats = await ctx.repos.categories.list();
  valheim = await addGame(ctx, {
    name: "Valheim",
    categoryId: defined(cats[1]).id,
    aliases: "",
    actorId: A1,
  });
  ctx.gateway.addChannel(CH);
  id = await createLfgPost(ctx, {
    authorId: U1,
    gameId: valheim.id,
    when: "tonight 9pm",
    note: "@everyone bring food",
    channelId: CH,
  });
  ctx.gateway.messages.clear();
});

const content = textOf;
const news = async () => defined(await ctx.repos.setup.get("newsChannelId"));
const panel = async () => defined(await ctx.repos.setup.get("panelChannelId"));

describe("createLfgPost", () => {
  test("pings only the game role and stores the post", async () => {
    ctx.gateway.calls.length = 0;
    const id2 = await createLfgPost(ctx, {
      authorId: U1,
      gameId: valheim.id,
      when: "  tonight 9pm ",
      note: "@everyone bring food",
      channelId: CH,
    });
    const { channelId, payload } = lastSend(ctx);
    expect(channelId).toBe(CH);
    expect(payload.allowedMentions).toEqual({ roles: [valheim.roleId], parse: [] });
    expect(content(payload)).toContain(`<@&${valheim.roleId}>`);
    expect(content(payload)).not.toContain("@everyone");
    const post = await ctx.repos.lfg.get(id2);
    expect(post?.when).toBe("tonight 9pm");
    expect(post?.gameName).toBe("Valheim");
  });

  test("the author starts in the In list and can drop out", async () => {
    expect(content(lastSend(ctx).payload)).toContain(`In (1): <@${U1}>`);
    expect((await ctx.repos.lfg.get(id))?.in).toEqual([U1]);
    const post = await respondToLfg(ctx, id, U1, "in");
    expect(post.in).toEqual([]);
  });

  test("deletes the sent message when storing the post fails", async () => {
    vi.spyOn(ctx.repos.lfg, "add").mockRejectedValueOnce(new Error("disk full"));
    await expect(
      createLfgPost(ctx, {
        authorId: U1,
        gameId: valheim.id,
        when: null,
        note: null,
        channelId: CH,
      }),
    ).rejects.toThrow("disk full");
    const sent = lastSend(ctx);
    expect(sent.channelId).toBe(CH);
    expect(ctx.gateway.calls.some((c) => c.method === "deleteMessage")).toBe(true);
    expect(ctx.gateway.messages.get(CH) ?? []).toEqual([]);
  });

  test("empty when and note become null; long ones are rejected", async () => {
    const base = { authorId: U1, gameId: valheim.id, channelId: CH };
    const ok = await createLfgPost(ctx, { ...base, when: "  ", note: "" });
    expect((await ctx.repos.lfg.get(ok))?.when).toBeNull();
    expect((await ctx.repos.lfg.get(ok))?.note).toBeNull();
    await expect(
      createLfgPost(ctx, { ...base, when: "x".repeat(101), note: null }),
    ).rejects.toThrow("Keep 'when' under 100 characters.");
    await expect(
      createLfgPost(ctx, { ...base, when: null, note: "x".repeat(301) }),
    ).rejects.toThrow("Keep the note under 300 characters.");
  });

  test("unknown game and missing role are explained", async () => {
    const base = { authorId: U1, channelId: CH, when: null, note: null };
    await expect(createLfgPost(ctx, { ...base, gameId: 9999 })).rejects.toThrow(
      "That game no longer exists.",
    );
    await ctx.gateway.deleteRole(valheim.roleId, "test");
    await expect(createLfgPost(ctx, { ...base, gameId: valheim.id })).rejects.toThrow(
      MESSAGES.gameRoleMissing,
    );
    expect(ctx.errorReports.length).toBeGreaterThan(0);
  });
});

describe("lfgChannel", () => {
  test("started from the panel or #game-roles, the post goes to #game-roles", async () => {
    // Members can't send in either channel; that doesn't matter here.
    expect(await lfgChannel(ctx, { channelId: await panel(), memberCanSend: false })).toBe(
      await news(),
    );
    expect(await lfgChannel(ctx, { channelId: await news(), memberCanSend: false })).toBe(
      await news(),
    );
  });

  test("started anywhere else, the post goes where it was started", async () => {
    expect(await lfgChannel(ctx, { channelId: CH, memberCanSend: true })).toBe(CH);
  });

  test("refuses a channel the member can't post in", async () => {
    await expect(lfgChannel(ctx, { channelId: CH, memberCanSend: false })).rejects.toBeInstanceOf(
      UserFacingError,
    );
  });
});

describe("respondToLfg", () => {
  test("re-renders the post with In/Maybe lists without re-pinging", async () => {
    await respondToLfg(ctx, id, U2, "in");
    const post = await respondToLfg(ctx, id, U3, "maybe");
    expect(post.in).toEqual([U1, U2]);
    expect(post.maybe).toEqual([U3]);
    const edit = lastEdit(ctx);
    expect(edit.channelId).toBe(CH);
    expect(edit.messageId).toBe(id);
    const payload = edit.payload;
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(content(payload)).toContain(`In (2): <@${U1}>, <@${U2}>`);
    expect(content(payload)).toContain(`Maybe (1): <@${U3}>`);
  });

  test("clicking the same button again clears the answer", async () => {
    await respondToLfg(ctx, id, U2, "in");
    const post = await respondToLfg(ctx, id, U2, "in");
    expect(post.in).toEqual([U1]);
  });

  test("switching from in to maybe moves the user", async () => {
    await respondToLfg(ctx, id, U2, "in");
    const post = await respondToLfg(ctx, id, U2, "maybe");
    expect(post.in).toEqual([U1]);
    expect(post.maybe).toEqual([U2]);
  });

  test("simultaneous clicks leave the visible lists complete", async () => {
    const originalEdit = ctx.gateway.edit.bind(ctx.gateway);
    const originalGet = ctx.repos.games.get.bind(ctx.repos.games);
    let landedLast: Payload = {};
    vi.spyOn(ctx.gateway, "edit").mockImplementation(async (...args) => {
      const result = await originalEdit(...args);
      landedLast = args[2];
      return result;
    });
    // Stall the first click after it has read the post, so the second click overtakes it.
    let first = true;
    vi.spyOn(ctx.repos.games, "get").mockImplementation(async (gameId) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 40));
      }
      return originalGet(gameId);
    });
    const a = respondToLfg(ctx, id, U2, "in");
    await new Promise((r) => setTimeout(r, 10));
    const b = respondToLfg(ctx, id, U3, "maybe");
    await Promise.all([a, b]);
    expect(content(landedLast)).toContain(`In (2): <@${U1}>, <@${U2}>`);
    expect(content(landedLast)).toContain(`Maybe (1): <@${U3}>`);
  });

  test("unknown post → UserFacingError, not a crash", async () => {
    const err = await respondToLfg(ctx, "999", U2, "in").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err).toMatchObject({ message: "That post is no longer active." });
    await expect(toggleRoleFromLfg(ctx, "999", U2)).rejects.toThrow(
      "That post is no longer active.",
    );
  });
});

describe("toggleRoleFromLfg", () => {
  test("joins the role, then leaves it, logging source 'LFG post' each time", async () => {
    ctx.gateway.addMember(U2, []);
    expect(await toggleRoleFromLfg(ctx, id, U2)).toEqual({ result: "joined", gameName: "Valheim" });
    expect(ctx.gateway.memberRoleIds(U2).has(valheim.roleId)).toBe(true);
    expect(ctx.logLines.at(-1)).toContain("(LFG post)");
    expect(await toggleRoleFromLfg(ctx, id, U2)).toEqual({ result: "left", gameName: "Valheim" });
    expect(ctx.gateway.memberRoleIds(U2).has(valheim.roleId)).toBe(false);
    expect(ctx.logLines.at(-1)).toContain("(LFG post)");
  });
});

test("buttons on a post whose game was removed answer 'This game has been removed.'", async () => {
  await removeGame(ctx, valheim.id, A1);
  await expect(respondToLfg(ctx, id, U2, "in")).rejects.toThrow("This game has been removed.");
  await expect(toggleRoleFromLfg(ctx, id, U2)).rejects.toThrow("This game has been removed.");
});

const starter = { userId: U1, isAdmin: false };
const admin = { userId: A2, isAdmin: true };
const someoneElse = { userId: U2, isAdmin: false };

describe("lfgPostToManage", () => {
  test("the starter and admins may manage the post", async () => {
    expect((await lfgPostToManage(ctx, id, starter)).messageId).toBe(id);
    expect((await lfgPostToManage(ctx, id, admin)).messageId).toBe(id);
  });

  test("anyone else is refused", async () => {
    await expect(lfgPostToManage(ctx, id, someoneElse)).rejects.toThrow(LFG_REFUSALS.notAllowed);
  });
});

describe("closeLfgPost", () => {
  test("finishing turns the post into a record of who went, without buttons or pings", async () => {
    await respondToLfg(ctx, id, U2, "in");
    await respondToLfg(ctx, id, U3, "maybe");
    await closeLfgPost(ctx, id, starter, "finished");
    const edit = lastEdit(ctx);
    expect(edit).toMatchObject({ channelId: CH, messageId: id });
    expect(buttonKinds(edit.payload)).toEqual([]);
    expect(edit.payload.allowedMentions).toEqual({ parse: [] });
    expect(content(edit.payload)).toContain(`<@${U1}>, <@${U2}>`);
    expect(content(edit.payload)).not.toContain(`<@${U3}>`);
    expect(await ctx.repos.lfg.get(id)).toMatchObject({
      status: "finished",
      closedBy: U1,
      in: [U1, U2],
      maybe: [U3],
    });
    expect(ctx.logLines.at(-1)).toContain(`<@${U1}> finished`);
  });

  test("an admin can cancel someone else's post, and it's logged as theirs", async () => {
    await closeLfgPost(ctx, id, admin, "cancelled");
    expect(buttonKinds(lastEdit(ctx).payload)).toEqual([]);
    expect(await ctx.repos.lfg.get(id)).toMatchObject({ status: "cancelled", closedBy: A2 });
    expect(ctx.logLines.at(-1)).toContain(`<@${A2}> cancelled`);
  });

  test("anyone else is refused, and the post stays open", async () => {
    ctx.gateway.calls.length = 0;
    await expect(closeLfgPost(ctx, id, someoneElse, "cancelled")).rejects.toThrow(
      LFG_REFUSALS.notAllowed,
    );
    expect((await ctx.repos.lfg.get(id))?.status).toBe("open");
    expect(ctx.gateway.calls.some((c) => c.method === "edit")).toBe(false);
  });

  test.each([
    ["finished", LFG_REFUSALS.finished],
    ["cancelled", LFG_REFUSALS.cancelled],
  ] as const)("once %s, every button on the post or its menu says so", async (outcome, why) => {
    await closeLfgPost(ctx, id, starter, outcome);
    await expect(respondToLfg(ctx, id, U2, "in")).rejects.toThrow(why);
    await expect(toggleRoleFromLfg(ctx, id, U2)).rejects.toThrow(why);
    await expect(lfgPostToManage(ctx, id, admin)).rejects.toThrow(why);
    await expect(closeLfgPost(ctx, id, admin, "finished")).rejects.toThrow(why);
    expect((await ctx.repos.lfg.get(id))?.closedBy).toBe(U1);
  });

  test("the starter can still close a post whose game was removed", async () => {
    await removeGame(ctx, valheim.id, A1);
    await closeLfgPost(ctx, id, starter, "cancelled");
    expect((await ctx.repos.lfg.get(id))?.status).toBe("cancelled");
  });

  test("a response that lands as the post closes can't bring the buttons back", async () => {
    const originalGet = ctx.repos.games.get.bind(ctx.repos.games);
    let first = true;
    vi.spyOn(ctx.repos.games, "get").mockImplementation(async (gameId) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 40));
      }
      return originalGet(gameId);
    });
    const respond = respondToLfg(ctx, id, U2, "in");
    await new Promise((r) => setTimeout(r, 10));
    await Promise.all([respond, closeLfgPost(ctx, id, starter, "finished")]);
    expect(buttonKinds(lastEdit(ctx).payload)).toEqual([]);
    expect(content(lastEdit(ctx).payload)).toContain(`<@${U1}>, <@${U2}>`);
  });
});
