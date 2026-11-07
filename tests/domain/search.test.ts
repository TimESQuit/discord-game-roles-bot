import { expect, test } from "vitest";
import { findCloseMatches, normalize, parseAliases, rankGames } from "../../src/domain/search.ts";

const g = (name: string, aliases: string[] = []) => ({ name, aliases });
const games = [
  g("Valheim"),
  g("Minecraft"),
  g("Red Dead Redemption 2"),
  g("Call of Duty", ["cod"]),
  g("World of Warcraft", ["wow"]),
  g("Dungeons & Dragons"),
  g("Pokémon Go"),
  g("Among Us"),
];

test("normalize: case, accents, punctuation, & → and", () => {
  expect(normalize("  Pokémon:  GO! ")).toBe("pokemon go");
  expect(normalize("Dungeons & Dragons")).toBe("dungeons and dragons");
  expect(normalize("Assassin's Creed")).toBe("assassins creed");
  expect(normalize("!!!")).toBe("");
});

test("prefix, word-start and inner matches are found, best first", () => {
  expect(rankGames("val", games)[0]?.name).toBe("Valheim");
  expect(rankGames("dead", games).map((x) => x.name)).toContain("Red Dead Redemption 2");
  expect(rankGames("craft", games).map((x) => x.name)).toContain("Minecraft");
});

test("typos still find the game, as the top result", () => {
  expect(rankGames("mincraft", games)[0]?.name).toBe("Minecraft");
  expect(rankGames("valhem", games)[0]?.name).toBe("Valheim");
});

test("unrelated query finds nothing", () => {
  expect(rankGames("zzz", games)).toEqual([]);
});

test("aliases count as names", () => {
  expect(rankGames("cod", games)[0]?.name).toBe("Call of Duty");
  expect(rankGames("wow", games)[0]?.name).toBe("World of Warcraft");
});

test("results are deterministic and capped at limit; blank keeps input order", () => {
  expect(rankGames("o", games).map((x) => x.name)).toEqual(
    rankGames("o", games).map((x) => x.name),
  );
  expect(rankGames("o", games, 2)).toHaveLength(2);
  expect(rankGames("", games, 3).map((x) => x.name)).toEqual([
    "Valheim",
    "Minecraft",
    "Red Dead Redemption 2",
  ]);
  expect(rankGames("   ", games, 2).map((x) => x.name)).toEqual(["Valheim", "Minecraft"]);
});

test("punctuation-only query matches nothing rather than everything", () => {
  expect(rankGames("!!!", games)).toEqual([]);
});

test("close matches for suggestions", () => {
  expect(findCloseMatches("valheim", games).map((x) => x.name)).toEqual(["Valheim"]);
  expect(findCloseMatches("Mine craft", games).map((x) => x.name)).toEqual(["Minecraft"]);
  expect(findCloseMatches("Valhiem", games).map((x) => x.name)).toEqual(["Valheim"]);
  expect(findCloseMatches("COD", games).map((x) => x.name)).toEqual(["Call of Duty"]);
  expect(findCloseMatches("Valorant", games)).toEqual([]);
  expect(findCloseMatches("go", games)).toEqual([]);
});

test("parseAliases: comma list, normalized, de-duplicated, empties dropped", () => {
  expect(parseAliases(" CoD, cod ,, Warzone ")).toEqual(["cod", "warzone"]);
});
