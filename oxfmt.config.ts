import { defineConfig } from "oxfmt";

const THIRD_PARTY = ["builtin", "external"] as const;
const LOCAL = ["internal", "subpath", "parent", "sibling", "index"] as const;

const BLANK_LINE = { newlinesBetween: true };

export default defineConfig({
  ignorePatterns: ["docs/**", "drizzle/**"],
  sortImports: {
    newlinesBetween: false,
    groups: [
      ...THIRD_PARTY,
      BLANK_LINE,
      [...LOCAL, "side_effect", "style", "unknown"],
      BLANK_LINE,
      ...THIRD_PARTY.map((selector) => `type-${selector}`),
      LOCAL.map((selector) => `type-${selector}`),
    ],
  },
});
