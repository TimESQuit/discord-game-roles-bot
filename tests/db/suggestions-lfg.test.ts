import { expect, test } from "vitest";
import { openDatabase } from "../../src/db/database.ts";
import { createRepos } from "../../src/db/repos/index.ts";

const U1 = "100000000000000001";
const U2 = "100000000000000002";
const U3 = "100000000000000003";
const ADMIN_A = "100000000000000011";
const ADMIN_B = "100000000000000012";
const M1 = "200000000000000001";
const CH = "300000000000000001";
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";

async function setup() {
  const r = createRepos(openDatabase(":memory:").kysely);
  const c = await r.categories.add("Competitive");
  const game = await r.games.add({
    name: "Rocket League",
    categoryId: c.id,
    roleId: "400000000000000001",
    aliases: [],
    addedBy: ADMIN_A,
    addedAt: T0,
  });
  return { r, c, game };
}

test("decide is first-wins", async () => {
  const { r, c } = await setup();
  const s = await r.suggestions.add({
    suggesterId: U1,
    name: "Valheim",
    categoryId: c.id,
    note: null,
    createdAt: T0,
  });
  expect(await r.suggestions.decide(s.id, "approved", ADMIN_A, T1)).toBe(true);
  expect(await r.suggestions.decide(s.id, "rejected", ADMIN_B, T1, "no")).toBe(false);
  expect(await r.suggestions.get(s.id)).toMatchObject({
    status: "approved",
    reviewerId: ADMIN_A,
    rejectionReason: null,
  });
});

test("rejecting stores the reason", async () => {
  const { r, c } = await setup();
  const s = await r.suggestions.add({
    suggesterId: U1,
    name: "Valheim",
    categoryId: c.id,
    note: "fun",
    createdAt: T0,
  });
  expect(await r.suggestions.decide(s.id, "rejected", ADMIN_A, T1, "too niche")).toBe(true);
  expect(await r.suggestions.get(s.id)).toMatchObject({
    status: "rejected",
    rejectionReason: "too niche",
    decidedAt: T1,
    note: "fun",
  });
});

test("undoDecision returns it to pending and clears reviewer fields", async () => {
  const { r, c } = await setup();
  const s = await r.suggestions.add({
    suggesterId: U1,
    name: "Valheim",
    categoryId: c.id,
    note: null,
    createdAt: T0,
  });
  await r.suggestions.decide(s.id, "rejected", ADMIN_A, T1, "no");
  await r.suggestions.undoDecision(s.id);
  expect(await r.suggestions.get(s.id)).toMatchObject({
    status: "pending",
    reviewerId: null,
    rejectionReason: null,
    decidedAt: null,
  });
  expect(await r.suggestions.decide(s.id, "approved", ADMIN_B, T2)).toBe(true);
});

test("countPending counts only that user's pending suggestions", async () => {
  const { r, c } = await setup();
  const add = (user: string, name: string) =>
    r.suggestions.add({ suggesterId: user, name, categoryId: c.id, note: null, createdAt: T0 });
  const a = await add(U1, "A");
  await add(U1, "B");
  await add(U2, "C");
  await r.suggestions.decide(a.id, "withdrawn", U1, T1);
  expect(await r.suggestions.countPending(U1)).toBe(1);
  expect(await r.suggestions.countPending(U2)).toBe(1);
  expect(await r.suggestions.countPending(U3)).toBe(0);
});

test("lists, pendingNames, update and links", async () => {
  const { r, c, game } = await setup();
  const a = await r.suggestions.add({
    suggesterId: U1,
    name: "A",
    categoryId: c.id,
    note: null,
    createdAt: T0,
  });
  const b = await r.suggestions.add({
    suggesterId: U1,
    name: "B",
    categoryId: c.id,
    note: null,
    createdAt: T1,
  });
  const d = await r.suggestions.add({
    suggesterId: U2,
    name: "D",
    categoryId: c.id,
    note: null,
    createdAt: T2,
  });
  expect((await r.suggestions.listByUser(U1)).map((s) => s.id)).toEqual([b.id, a.id]);
  expect((await r.suggestions.listPending()).map((s) => s.id)).toEqual([a.id, b.id, d.id]);
  await r.suggestions.decide(a.id, "approved", ADMIN_A, T2);
  expect(await r.suggestions.pendingNames()).toEqual([
    { id: b.id, name: "B" },
    { id: d.id, name: "D" },
  ]);
  await r.suggestions.update(b.id, { name: "B2", note: "hi" });
  await r.suggestions.setReviewMessage(b.id, M1);
  await r.suggestions.setGame(b.id, game.id);
  expect(await r.suggestions.get(b.id)).toMatchObject({
    name: "B2",
    note: "hi",
    categoryId: c.id,
    reviewMessageId: M1,
    gameId: game.id,
  });
  expect(await r.suggestions.get(9999)).toBeUndefined();
});

test("LFG responses: setting maybe after in replaces it; null clears", async () => {
  const { r, game } = await setup();
  await r.lfg.add({
    messageId: M1,
    channelId: CH,
    gameId: game.id,
    gameName: game.name,
    authorId: U1,
    when: "tonight 9pm",
    note: null,
    createdAt: T0,
  });
  await r.lfg.setResponse(M1, U2, "in");
  await r.lfg.setResponse(M1, U2, "maybe");
  expect(await r.lfg.get(M1)).toMatchObject({ in: [], maybe: [U2] });
  await r.lfg.setResponse(M1, U2, null);
  expect(await r.lfg.get(M1)).toMatchObject({ in: [], maybe: [] });
});

test("LFG lists keep response order", async () => {
  const { r, game } = await setup();
  await r.lfg.add({
    messageId: M1,
    channelId: CH,
    gameId: game.id,
    gameName: game.name,
    authorId: U1,
    when: null,
    note: null,
    createdAt: T0,
  });
  await r.lfg.setResponse(M1, U3, "in");
  await r.lfg.setResponse(M1, U2, "in");
  await r.lfg.setResponse(M1, U1, "maybe");
  expect(await r.lfg.get(M1)).toMatchObject({ in: [U3, U2], maybe: [U1] });
  await r.lfg.setResponse(M1, U3, "maybe");
  expect(await r.lfg.get(M1)).toMatchObject({ in: [U2], maybe: [U1, U3] });
  expect(await r.lfg.get("999")).toBeUndefined();
});

test("removing a game keeps its LFG posts, with gameId null and gameName kept", async () => {
  const { r, c, game } = await setup();
  await r.lfg.add({
    messageId: M1,
    channelId: CH,
    gameId: game.id,
    gameName: game.name,
    authorId: U1,
    when: null,
    note: null,
    createdAt: T0,
  });
  const s = await r.suggestions.add({
    suggesterId: U1,
    name: "X",
    categoryId: c.id,
    note: null,
    createdAt: T0,
  });
  await r.suggestions.setGame(s.id, game.id);
  await r.games.remove(game.id);
  expect(await r.lfg.get(M1)).toMatchObject({ gameId: null, gameName: "Rocket League" });
  expect(await r.suggestions.get(s.id)).toMatchObject({ gameId: null });
});
