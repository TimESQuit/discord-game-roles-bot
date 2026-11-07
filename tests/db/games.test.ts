import { expect, test } from "vitest";
import { migrate, openDatabase } from "../../src/db/database.ts";
import { createRepos } from "../../src/db/repos.ts";

function setupRepos() {
  const repos = createRepos(openDatabase(":memory:"));
  const category = repos.categories.add("Competitive");
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

test("migrations are idempotent", () => {
  const db = openDatabase(":memory:");
  expect(() => migrate(db)).not.toThrow();
});

test("categories keep display order and move", () => {
  const r = createRepos(openDatabase(":memory:"));
  const [a, b] = [r.categories.add("Competitive"), r.categories.add("Chill")];
  r.categories.move(b.id, "up");
  expect(r.categories.list().map((c) => c.name)).toEqual(["Chill", "Competitive"]);
  r.categories.move(b.id, "up");
  expect(r.categories.list()[0]?.id).toBe(b.id);
  r.categories.move(a.id, "down");
  expect(r.categories.list().map((c) => c.name)).toEqual(["Chill", "Competitive"]);
  r.categories.rename(a.id, "Ranked");
  expect(r.categories.get(a.id)?.name).toBe("Ranked");
  expect(r.categories.get(9999)).toBeUndefined();
});

test("games round-trip with aliases and are listed A→Z by normalized name", () => {
  const { repos, category } = setupRepos();
  repos.games.add(gameInput("valheim", category.id, "200000000000000001", ["val"]));
  const among = repos.games.add(
    gameInput("Among Us", category.id, "200000000000000002", ["Sus", "amogus"]),
  );
  expect(repos.games.list().map((g) => g.name)).toEqual(["Among Us", "valheim"]);
  const got = repos.games.get(among.id);
  expect(got).toEqual(among);
  expect(got?.aliases.toSorted()).toEqual(["amogus", "sus"]);
  expect(repos.games.byRoleId("200000000000000001")?.name).toBe("valheim");
  expect(repos.games.byNormalizedName("among us")?.id).toBe(among.id);
  const updated = repos.games.update(among.id, { name: "Among Us 2", aliases: ["Impostor"] });
  expect(updated.name).toBe("Among Us 2");
  expect(updated.aliases).toEqual(["impostor"]);
  expect(repos.games.byNormalizedName("among us 2")?.id).toBe(among.id);
});

test("a duplicate normalized name is rejected by the database", () => {
  const { repos, category } = setupRepos();
  repos.games.add(gameInput("Pokémon Go", category.id, "200000000000000001"));
  expect(() =>
    repos.games.add(gameInput("pokemon go!", category.id, "200000000000000002")),
  ).toThrow(/UNIQUE/);
});

test("ownsRole is true only for roles in the games table", () => {
  const { repos, category } = setupRepos();
  repos.games.add(gameInput("Valheim", category.id, "200000000000000001"));
  expect(repos.games.ownsRole("200000000000000001")).toBe(true);
  expect(repos.games.ownsRole("999")).toBe(false);
});

test("removing a game removes its aliases", () => {
  const db = openDatabase(":memory:");
  const repos = createRepos(db);
  const category = repos.categories.add("Chill");
  const game = repos.games.add(gameInput("Valheim", category.id, "200000000000000001", ["val"]));
  repos.games.remove(game.id);
  expect(repos.games.get(game.id)).toBeUndefined();
  expect(repos.games.ownsRole("200000000000000001")).toBe(false);
  const row = db.prepare("SELECT COUNT(*) AS n FROM game_aliases").get();
  expect(row?.n).toBe(0);
});

test("setup keys round-trip", () => {
  const { repos } = setupRepos();
  expect(repos.setup.get("templateRoleId")).toBeUndefined();
  repos.setup.set("templateRoleId", "300000000000000001");
  repos.setup.set("templateRoleId", "300000000000000002");
  repos.setup.set("logChannelId", "300000000000000003");
  expect(repos.setup.get("templateRoleId")).toBe("300000000000000002");
  expect(repos.setup.all()).toEqual({
    templateRoleId: "300000000000000002",
    logChannelId: "300000000000000003",
  });
});
