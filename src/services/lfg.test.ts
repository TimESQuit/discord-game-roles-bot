import { beforeEach, describe, expect, test, vi } from "vitest";

import { UserFacingError } from "../errors.ts";
import {
  A1,
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
import { createLfgPost, joinFromLfg, respondToLfg } from "./lfg.ts";

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
      "That game's role is missing; the admins have been told.",
    );
    expect(ctx.adminNotices.length).toBeGreaterThan(0);
  });
});

describe("respondToLfg", () => {
  test("re-renders the post with In/Maybe lists without re-pinging", async () => {
    await respondToLfg(ctx, id, U2, "in");
    const post = await respondToLfg(ctx, id, U3, "maybe");
    expect(post.in).toEqual([U2]);
    expect(post.maybe).toEqual([U3]);
    const edit = lastEdit(ctx);
    expect(edit.channelId).toBe(CH);
    expect(edit.messageId).toBe(id);
    const payload = edit.payload;
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(content(payload)).toContain(`In (1): <@${U2}>`);
    expect(content(payload)).toContain(`Maybe (1): <@${U3}>`);
  });

  test("clicking the same button again clears the answer", async () => {
    await respondToLfg(ctx, id, U2, "in");
    const post = await respondToLfg(ctx, id, U2, "in");
    expect(post.in).toEqual([]);
  });

  test("switching from in to maybe moves the user", async () => {
    await respondToLfg(ctx, id, U2, "in");
    const post = await respondToLfg(ctx, id, U2, "maybe");
    expect(post.in).toEqual([]);
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
    expect(content(landedLast)).toContain(`In (1): <@${U2}>`);
    expect(content(landedLast)).toContain(`Maybe (1): <@${U3}>`);
  });

  test("unknown post → UserFacingError, not a crash", async () => {
    const err = await respondToLfg(ctx, "999", U2, "in").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err).toMatchObject({ message: "That post is no longer active." });
    await expect(joinFromLfg(ctx, "999", U2)).rejects.toThrow("That post is no longer active.");
  });
});

describe("joinFromLfg", () => {
  test("joins the role and logs source 'LFG post'", async () => {
    ctx.gateway.addMember(U2, []);
    expect(await joinFromLfg(ctx, id, U2)).toBe("joined");
    expect(ctx.gateway.memberRoleIds(U2).has(valheim.roleId)).toBe(true);
    expect(ctx.logLines.at(-1)).toContain("(LFG post)");
    expect(await joinFromLfg(ctx, id, U2)).toBe("already");
  });
});

test("buttons on a post whose game was removed answer 'This game has been removed.'", async () => {
  await removeGame(ctx, valheim.id, A1);
  await expect(respondToLfg(ctx, id, U2, "in")).rejects.toThrow("This game has been removed.");
  await expect(joinFromLfg(ctx, id, U2)).rejects.toThrow("This game has been removed.");
});
