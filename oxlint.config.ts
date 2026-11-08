import { defineConfig } from "oxlint";

/** Source folders that may only be imported from outside through their index.ts barrel. */
const BARREL_FOLDERS = [
  "db",
  "discord",
  "domain",
  "services",
  "interactions",
  "views",
  "testing",
] as const;

type BarrelFolder = (typeof BARREL_FOLDERS)[number];

const barrelOnly = (folder: BarrelFolder) => ({
  group: [`**/${folder}/**`, `!**/${folder}/index.ts`],
  message: `Import ${folder} only through its index.ts (../${folder}/index.ts).`,
});

const noOwnBarrel = {
  group: ["./index.ts", "../index.ts"],
  message: "Do not import your own folder barrel; import the sibling file directly.",
};

export default defineConfig({
  plugins: ["typescript", "unicorn", "import", "vitest"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
  },
  rules: {
    "typescript/no-floating-promises": "error",
    "eslint/no-await-in-loop": "off",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    "import/no-cycle": "error",
    "no-restricted-imports": ["error", { patterns: BARREL_FOLDERS.map(barrelOnly) }],
  },
  overrides: BARREL_FOLDERS.map((folder) => ({
    files: [`src/${folder}/**`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...BARREL_FOLDERS.filter((other) => other !== folder).map(barrelOnly),
            noOwnBarrel,
          ],
        },
      ],
    },
  })),
});
