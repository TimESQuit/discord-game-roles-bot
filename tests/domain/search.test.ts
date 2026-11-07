import { expect, test } from "vitest";
import {
  findCloseMatches,
  matchTier,
  normalize,
  parseAliases,
  rankGames,
} from "../../src/domain/search.ts";

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

test("tiers in spec order", () => {
  expect(matchTier("val", g("Valheim"))).toBe(0);
  expect(matchTier("dead", g("Red Dead Redemption 2"))).toBe(1);
  expect(matchTier("craft", g("Minecraft"))).toBe(2);
  expect(matchTier("mincraft", g("Minecraft"))).toBe(3);
  expect(matchTier("valhem", g("Valheim"))).toBe(3);
  expect(matchTier("rdr2", g("Red Dead Redemption 2"))).toBe(4);
  expect(matchTier("zzz", g("Valheim"))).toBeNull();
});

test("aliases count as names", () => {
  expect(rankGames("cod", games)[0]?.name).toBe("Call of Duty");
  expect(rankGames("wow", games)[0]?.name).toBe("World of Warcraft");
});

test("ranks by tier, then alphabetically; caps at limit", () => {
  expect(
    rankGames("o", games)
      .map((x) => x.name)
      .slice(0, 2),
  ).toEqual(["Call of Duty", "World of Warcraft"]);
  expect(rankGames("", games, 3)).toHaveLength(3);
});

test("typos need ≥3 chars", () => {
  expect(matchTier("vx", g("Valheim"))).toBeNull();
});

test("punctuation-only query matches nothing rather than everything", () => {
  expect(rankGames("!!!", games)).toEqual([]);
});

test("close matches for suggestions", () => {
  expect(findCloseMatches("valheim", games).map((x) => x.name)).toEqual(["Valheim"]);
  expect(findCloseMatches("Mine craft", games).map((x) => x.name)).toEqual(["Minecraft"]);
  expect(findCloseMatches("Valhiem", games).map((x) => x.name)).toEqual(["Valheim"]);
  expect(findCloseMatches("RDR2", games).map((x) => x.name)).toEqual(["Red Dead Redemption 2"]);
  expect(findCloseMatches("COD", games).map((x) => x.name)).toEqual(["Call of Duty"]);
  expect(findCloseMatches("Valorant", games)).toEqual([]);
});

test("parseAliases: comma list, normalized, de-duplicated, empties dropped", () => {
  expect(parseAliases(" CoD, cod ,, Warzone ")).toEqual(["cod", "warzone"]);
});
