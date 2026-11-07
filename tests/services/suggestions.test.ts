import { beforeEach, describe, expect, test } from "vitest";
import type { Suggestion } from "../../src/db/types.ts";
import {
  approveSuggestion,
  closeMatches,
  editSuggestion,
  rejectSuggestion,
  submitSuggestion,
  withdrawSuggestion,
} from "../../src/services/suggestions.ts";
import { addGame } from "../../src/services/games.ts";
import { A1, A2, U1, U2, makeContext, sentTo } from "../fakes/context.ts";
import type { TestContext } from "../fakes/context.ts";

let ctx: TestContext;
let chill: { id: number; name: string };
let comp: { id: number; name: string };

beforeEach(async () => {
  ctx = await makeContext();
  const cats = await ctx.repos.categories.list();
  comp = cats.find((c) => c.name === "Competitive")!;
  chill = cats.find((c) => c.name === "Chill")!;
});

const suggest = (name = "Valheim", userId = U1): Promise<Suggestion> =>
  submitSuggestion(ctx, { userId, name, categoryId: chill.id, note: null });

async function adminChannelId(): Promise<string> {
  return (await ctx.repos.setup.get("adminChannelId"))!;
}
async function card(s: Suggestion) {
  const reviewMessageId = (await ctx.repos.suggestions.get(s.id))!.reviewMessageId;
  const list = ctx.gateway.messages.get(await adminChannelId()) ?? [];
  return list.find((m) => m.id === reviewMessageId)!.payload;
}

describe("submit", () => {
  test("posts a review card in #bot-admin and records its message", async () => {
    const s = await suggest();
    expect((await ctx.repos.suggestions.get(s.id))?.reviewMessageId).toBeTruthy();
    expect(ctx.logLines).toContain(`<@${U1}> suggested **Valheim**`);
    const payload = await card(s);
    expect(payload.content).toContain("Valheim");
    expect(JSON.stringify(payload.components)).toContain(`gr:review-approve:${s.id}`);
  });

  test("11th pending suggestion is refused with the limit in the message", async () => {
    for (let i = 0; i < 10; i++) await suggest(`Game ${i}`);
    await expect(suggest("Game 10")).rejects.toThrow(
      "You already have 10 pending suggestions. Withdraw one or wait for an admin to review them.",
    );
  });

  test("refuses an invalid name, an unknown category, and a missing admin channel", async () => {
    await expect(suggest("   ")).rejects.toThrow(/letter or number/);
    await expect(
      submitSuggestion(ctx, { userId: U1, name: "X", categoryId: 9999, note: null }),
    ).rejects.toThrow("That category doesn't exist.");
    const bare = await makeContext({ setup: false });
    await bare.repos.categories.add("Chill");
    const cat = (await bare.repos.categories.list())[0]!;
    await expect(
      submitSuggestion(bare, { userId: U1, name: "X", categoryId: cat.id, note: null }),
    ).rejects.toThrow("Run /gameadmin setup first.");
  });
});

describe("closeMatches", () => {
  test("finds games and pending suggestions", async () => {
    await addGame(ctx, { name: "Valheim", categoryId: chill.id, aliases: "", actorId: A1 });
    const s = await suggest("Rocket League");
    const hit = await closeMatches(ctx, "valhiem");
    expect(hit.games.map((g) => g.name)).toEqual(["Valheim"]);
    expect(hit.pending).toEqual([]);
    const hit2 = await closeMatches(ctx, "rocket league");
    expect(hit2.pending).toEqual([{ id: s.id, name: "Rocket League" }]);
    expect(hit2.games).toEqual([]);
  });
});

describe("approve", () => {
  test("creates the game, adds the suggester, announces in #game-news, updates the card, logs", async () => {
    ctx.gateway.addMember(U1, ["100000000000000999"]);
    const s = await suggest();
    const game = await approveSuggestion(ctx, s.id, A1);
    expect(ctx.gateway.memberRoleIds(U1).has(game.roleId)).toBe(true);
    const news = sentTo(ctx, "newsChannelId");
    expect(news).toHaveLength(1);
    expect(news[0]?.content).toBe(`New game: **Valheim** — <@&${game.roleId}>`);
    expect(await ctx.repos.suggestions.get(s.id)).toMatchObject({
      status: "approved",
      reviewerId: A1,
      gameId: game.id,
    });
    const payload = await card(s);
    expect(payload.content).toContain(`Approved by <@${A1}>`);
    expect(payload.components ?? []).toHaveLength(0);
    expect(ctx.logLines).toContain(`<@${A1}> approved suggestion **Valheim**`);
    expect(ctx.logLines).toContain(`<@${A1}> added game **Valheim**`);
  });

  test("does not add a suggester who is not cached (left the server)", async () => {
    const s = await suggest();
    const game = await approveSuggestion(ctx, s.id, A1);
    expect(ctx.gateway.roleMemberIds(game.roleId)).toEqual([]);
    expect(sentTo(ctx, "newsChannelId")).toHaveLength(1);
  });

  test("second approve (or reject) of the same card is refused, nothing created twice", async () => {
    const s = await suggest();
    await approveSuggestion(ctx, s.id, A1);
    await expect(approveSuggestion(ctx, s.id, A2)).rejects.toThrow(
      "This suggestion was already approved.",
    );
    await expect(rejectSuggestion(ctx, s.id, A2, "no")).rejects.toThrow(
      "This suggestion was already approved.",
    );
    expect(await ctx.repos.games.list()).toHaveLength(1);
  });

  test("two admins approving at once create one game", async () => {
    const s = await suggest();
    const results = await Promise.allSettled([
      approveSuggestion(ctx, s.id, A1),
      approveSuggestion(ctx, s.id, A2),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ctx.repos.games.list()).toHaveLength(1);
    expect(sentTo(ctx, "newsChannelId")).toHaveLength(1);
  });

  test("approve after withdraw is refused", async () => {
    const s = await suggest();
    await withdrawSuggestion(ctx, s.id, U1);
    await expect(approveSuggestion(ctx, s.id, A1)).rejects.toThrow(
      "This suggestion was already withdrawn.",
    );
    expect(await ctx.repos.games.list()).toHaveLength(0);
  });

  test("approve fails in Discord: suggestion is pending again", async () => {
    const s = await suggest();
    ctx.gateway.failNext("createRole", new Error("boom"));
    await expect(approveSuggestion(ctx, s.id, A1)).rejects.toThrow("boom");
    expect(await ctx.repos.suggestions.get(s.id)).toMatchObject({
      status: "pending",
      reviewerId: null,
    });
    const game = await approveSuggestion(ctx, s.id, A2);
    expect(game.name).toBe("Valheim");
  });

  test("a failed announcement does not undo the approval and tells the admins", async () => {
    const s = await suggest();
    // The card is already posted; the next send is the announcement.
    ctx.gateway.failNext("send", new Error("no news"));
    await approveSuggestion(ctx, s.id, A1);
    expect((await ctx.repos.suggestions.get(s.id))?.status).toBe("approved");
    expect(await ctx.repos.games.list()).toHaveLength(1);
    expect(ctx.adminNotices.some((n) => n.includes("Valheim"))).toBe(true);
  });
});

describe("edit", () => {
  test("changes name/category before approval; aliases carry into the game", async () => {
    const s = await suggest();
    const edited = await editSuggestion(
      ctx,
      s.id,
      { name: "Valheim Deluxe", categoryId: comp.id, aliases: "vh, valhe" },
      A1,
    );
    expect(edited).toMatchObject({
      name: "Valheim Deluxe",
      categoryId: comp.id,
      aliases: "vh, valhe",
    });
    const payload = await card(s);
    expect(payload.content).toContain("Valheim Deluxe");
    expect(payload.content).toContain("vh, valhe");
    expect(ctx.logLines).toContain(`<@${A1}> edited suggestion **Valheim Deluxe**`);
    const game = await approveSuggestion(ctx, s.id, A1);
    expect(game).toMatchObject({
      name: "Valheim Deluxe",
      categoryId: comp.id,
      aliases: ["valhe", "vh"],
    });
  });

  test("is refused once decided", async () => {
    const s = await suggest();
    await rejectSuggestion(ctx, s.id, A1, "no");
    await expect(editSuggestion(ctx, s.id, { name: "Other" }, A1)).rejects.toThrow(
      "This suggestion was already rejected.",
    );
    await expect(editSuggestion(ctx, 9999, { name: "Other" }, A1)).rejects.toThrow(
      "That suggestion no longer exists.",
    );
  });
});

describe("reject and withdraw", () => {
  test("reject stores the reason, edits the card, logs", async () => {
    const s = await suggest();
    await expect(rejectSuggestion(ctx, s.id, A1, "   ")).rejects.toThrow("Please give a reason.");
    await rejectSuggestion(ctx, s.id, A1, "too niche");
    expect(await ctx.repos.suggestions.get(s.id)).toMatchObject({
      status: "rejected",
      rejectionReason: "too niche",
      reviewerId: A1,
    });
    expect((await card(s)).content).toContain(`Rejected by <@${A1}>: too niche`);
    expect(ctx.logLines).toContain(`<@${A1}> rejected suggestion **Valheim**: too niche`);
  });

  test("withdraw only by the suggester and only while pending", async () => {
    const s = await suggest();
    await expect(withdrawSuggestion(ctx, s.id, U2)).rejects.toThrow(
      "You can only withdraw your own suggestions.",
    );
    await withdrawSuggestion(ctx, s.id, U1);
    await expect(withdrawSuggestion(ctx, s.id, U1)).rejects.toThrow(
      "This suggestion was already withdrawn.",
    );
    await expect(withdrawSuggestion(ctx, 9999, U1)).rejects.toThrow(
      "That suggestion no longer exists.",
    );
  });

  test("withdraw marks the review card withdrawn and logs it", async () => {
    const s = await suggest();
    await withdrawSuggestion(ctx, s.id, U1);
    const payload = await card(s);
    expect(payload.content).toContain("Withdrawn");
    expect(payload.components ?? []).toHaveLength(0);
    expect(ctx.logLines).toContain(`<@${U1}> withdrawn suggestion **Valheim**`);
  });
});
