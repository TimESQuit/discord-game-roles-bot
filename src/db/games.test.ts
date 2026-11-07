import { expect, test } from "vitest";
import { openDatabase } from "./database.ts";
import { createRepos } from "./repos/index.ts";

async function setupRepos() {
  const repos = createRepos(openDatabase(":memory:").kysely);
  const category = await repos.categories.add("Competitive");
  return { repos, category };
}

function gameInput(name: string, categoryId: number, roleId: string, aliases: string[] = []) {
  return {
    name,
    categoryId,
    roleId,
    aliases,
    addedBy: "100000000000000001",
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("categories keep display order and move", async () => {
  const r = createRepos(openDatabase(":memory:").kysely);
  const [a, b] = [await r.categories.add("Competitive"), await r.categories.add("Chill")];
  await r.categories.move(b.id, "up");
  expect((await r.categories.list()).map((c) => c.name)).toEqual(["Chill", "Competitive"]);
  await r.categories.move(b.id, "up");
  expect((await r.categories.list())[0]?.id).toBe(b.id);
  await r.categories.move(a.id, "down");
  expect((await r.categories.list()).map((c) => c.name)).toEqual(["Chill", "Competitive"]);
  await r.categories.rename(a.id, "Ranked");
  expect((await r.categories.get(a.id))?.name).toBe("Ranked");
  expect(await r.categories.get(9999)).toBeUndefined();
});

test("games round-trip with aliases and are listed A→Z by normalized name", async () => {
  const { repos, category } = await setupRepos();
  await repos.games.add(gameInput("valheim", category.id, "200000000000000001", ["val"]));
  const among = await repos.games.add(
    gameInput("Among Us", category.id, "200000000000000002", ["Sus", "amogus"]),
  );
  expect((await repos.games.list()).map((g) => g.name)).toEqual(["Among Us", "valheim"]);
  const got = await repos.games.get(among.id);
  expect(got).toEqual(among);
  expect(got?.aliases.toSorted()).toEqual(["amogus", "sus"]);
  expect((await repos.games.byRoleId("200000000000000001"))?.name).toBe("valheim");
  expect((await repos.games.byNormalizedName("among us"))?.id).toBe(among.id);
  const updated = await repos.games.update(among.id, { name: "Among Us 2", aliases: ["Impostor"] });
  expect(updated.name).toBe("Among Us 2");
  expect(updated.aliases).toEqual(["impostor"]);
  expect((await repos.games.byNormalizedName("among us 2"))?.id).toBe(among.id);
});

test("a duplicate normalized name is rejected by the database", async () => {
  const { repos, category } = await setupRepos();
  await repos.games.add(gameInput("Pokémon Go", category.id, "200000000000000001"));
  await expect(
    repos.games.add(gameInput("pokemon go!", category.id, "200000000000000002")),
  ).rejects.toThrow(/UNIQUE/);
});

test("ownsRole is true only for roles in the games table", async () => {
  const { repos, category } = await setupRepos();
  await repos.games.add(gameInput("Valheim", category.id, "200000000000000001"));
  expect(await repos.games.ownsRole("200000000000000001")).toBe(true);
  expect(await repos.games.ownsRole("999")).toBe(false);
});

test("removing a game removes its aliases", async () => {
  const db = openDatabase(":memory:");
  const repos = createRepos(db.kysely);
  const category = await repos.categories.add("Chill");
  const game = await repos.games.add(
    gameInput("Valheim", category.id, "200000000000000001", ["val"]),
  );
  await repos.games.remove(game.id);
  expect(await repos.games.get(game.id)).toBeUndefined();
  expect(await repos.games.ownsRole("200000000000000001")).toBe(false);
  const row = db.sqlite.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM game_aliases").get();
  expect(row?.n).toBe(0);
});

test("setup keys round-trip", async () => {
  const { repos } = await setupRepos();
  expect(await repos.setup.get("templateRoleId")).toBeUndefined();
  await repos.setup.set("templateRoleId", "300000000000000001");
  await repos.setup.set("templateRoleId", "300000000000000002");
  await repos.setup.set("logChannelId", "300000000000000003");
  expect(await repos.setup.get("templateRoleId")).toBe("300000000000000002");
  expect(await repos.setup.all()).toEqual({
    templateRoleId: "300000000000000002",
    logChannelId: "300000000000000003",
  });
});
