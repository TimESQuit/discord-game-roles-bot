# Game Roles Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private Discord bot that lets members opt in and out of game roles from one panel button, suggest games for admin approval, and post "looking for group" calls. The plan also covers its Docker deployment to the droplet.

**Architecture:** Pure decision logic (`src/domain/`) and SQLite repositories (`src/db/`) are covered by Vitest. Services (`src/services/`) combine them through a thin `Gateway` interface over discord.js, so tests run against an in-memory fake. Views (`src/views/`) build message payloads. Interaction handlers (`src/interactions/`) parse, check admin rights, acknowledge the interaction and call one service. `src/main.ts` wires it all together.

**Tech Stack:** Node.js 26 running `.ts` directly, TypeScript 7.0 (type-check only), discord.js 14.28.1, SQLite through better-sqlite3 (Drizzle for the schema and migrations, Kysely for queries), Vitest 5, oxlint and oxlint-tsgolint (type-aware), oxfmt, pnpm 12, Docker Compose and GitHub Actions.

**Spec:** `docs/design.md`, exported from the Claude Docs doc "Game Roles Bot — Design". The live doc wins if they differ.

**Not in this plan:** the migration script. The spec keeps it out of the repo, so it gets its own plan once the bot runs on the test server.

## Decisions taken for the spec's open items

These are defaults so that work can start. Each sits in one place and is cheap to change.

| Open item | Default in this plan | Where it lives |
| --- | --- | --- |
| Panel channel name | `game-roles` | `PANEL_CHANNEL_NAME` in `src/constants.ts` |
| LFG channel limits, expiry, threads, author edits | None in v1, as the spec says | — |
| SQLite driver | better-sqlite3, chosen by the user after Task 9 (Task 9b replaces the first `node:sqlite` version). It has `backup()` for consistent snapshots | `src/db/database.ts` |
| Schema and migrations | Tables are described in `src/db/schema.ts` with Drizzle. `pnpm db:generate` (drizzle-kit) writes each migration as SQL from the schema change, like Django's `makemigrations`. Queries use Kysely, with table types derived from the same schema. `pnpm check` fails if the schema changed without a migration | `src/db/schema.ts`, `drizzle/` |
| Fuzzy matching | fuse.js (changed after the build at the user's request; replaces the hand-written tiered matcher) | `src/domain/search.ts` |
| Nightly backup time | 04:00 UTC | `BACKUP_HOUR_UTC` env var |
| healthchecks.io | Ping every 5 min. Set the check's period to 5 min and its grace to 10 min | `HEARTBEAT_INTERVAL_MS` in `src/constants.ts` |
| Container memory limit | `256m` (revisit after checking the droplet) | `compose.yaml` |
| Slash command registration | On every startup: a bulk overwrite of guild commands, which is idempotent | `src/interactions/commands.ts` |
| License | **The user's call.** MIT is assumed until they answer, before Task 21 | `LICENSE` |

Three things Discord forces:

- A command with subcommands can't also be run on its own. So the menu opens with **`/games menu`**, not bare `/games`.
- Pop-up forms (modals) can't autocomplete. In the panel, "Who plays…?", LFG, and the admin Edit and Remove actions pick a game from per-category single-select dropdowns first. Slash commands keep autocomplete.
- "Submit anyway" after "Did you mean…?" needs the typed suggestion back. The draft is kept in memory for 15 minutes, keyed by user ID.

## Global Constraints

- Node ≥ 26, `"type": "module"`. Relative imports end in `.ts`. `erasableSyntaxOnly` is on: no `enum`, no `namespace`, no constructor parameter properties.
- Exact versions with no `^` or `~`: `discord.js@14.28.1`, `typescript@7.0.2`, `oxlint@1.92.0`, `oxlint-tsgolint@7.0.2006`, `oxfmt@0.77.0`, `vitest@5.1.0`, `@types/node@26.6.6`, `better-sqlite3@13.0.3`, `@types/better-sqlite3@9.6.0`, `kysely@0.29.8`, `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `packageManager: pnpm@12.18.0`.
- Database access goes through the repos, and every repo method is async (Kysely). Tables change only through a migration generated from `src/db/schema.ts`.
- The bot adds, removes, renames or deletes only roles whose IDs are in the `games` table. It reads the template role and never changes it after creating it.
- No DMs, ever. Private answers are ephemeral replies (`MessageFlags.Ephemeral`).
- Every member and admin action writes exactly one `#bot-log` line (see `AuditEvent`, Task 8).
- Admin rights are checked when the action is handled, on every admin custom ID, modal and `/gameadmin` command. Showing the buttons is not the check.
- The bot stores only Discord user IDs, never names. Tests use made-up IDs such as `"100000000000000001"`. No real server, channel, role or member data goes in the repo.
- Acknowledge every interaction within 3 s: call `deferReply`/`deferUpdate` before any Discord API call. Autocomplete awaits only local SQLite reads and the member cache, never a Discord API call, so it stays well inside 3 s.
- The client default is `allowedMentions: { parse: [] }`. Only the LFG post opts in, and only for its own game role.
- Discord limits: 25 options per select, 25 autocomplete choices, 40 components per message (layout V2), 100 characters per label, option, role name and custom ID.
- Fixed copy: channels `game-news`, `bot-admin`, `bot-log`, `bot-backups`; category `Bot admin`; template role `Game role template`; starting categories `Competitive`, `Chill`, `IRL activities`; pending-suggestion limit 10; backup retention 30 days.

## Review Focus

1. **Two admins act on one suggestion card, or an admin approves after the member withdrew.** Exactly one decision lands. The second admin gets "This suggestion was already approved." Test in Task 11.
2. **A game's Discord role was deleted by hand.** Menus still render. Joining replies "That game's role is missing; the admins have been told." `#bot-admin` gets a notice. Remove game still deletes the database row. Tests in Tasks 9 and 10.
3. **A category with 0 games or more than 25, a menu over 40 components, or a stale dropdown submitted after a game was removed.** No select is sent with 0 options. Categories split into chunks of 25, and the menu pages. Unknown selections are ignored. Tests in Tasks 4, 10 and 16.
4. **User text that contains mentions** (`@everyone`, `<@&id>`) in game names, notes, LFG "when" or rejection reasons. It never pings anyone. Tests in Tasks 17 and 18.
5. **The bot lost Manage Roles, or its role was dragged below the template after setup.** Role actions reply with the exact fix ("Move the bot's role above Game role template in Server Settings → Roles") instead of "This interaction failed". Test in Task 9.

---

## File structure

```
src/
  main.ts                    client, events, startup (Task 20)
  config.ts                  env → Config (Task 2)
  constants.ts               names, limits, intervals (Task 1, grown as needed)
  errors.ts                  UserFacingError (Task 2)
  domain/
    search.ts                normalize, rankGames, findCloseMatches, parseAliases (Task 3)
    roles.ts                 diffSelection, computeRoleOrder, chunk, isAdmin, validateGameName (Task 4)
    lfg.ts                   toggleResponse (Task 12)
    setup-plan.ts            planSetup (Task 13)
    schedule.ts              msUntilNextRun, selectExpiredBackups (Task 14)
  db/
    schema.ts                Drizzle table definitions: the source of truth for tables (Task 9b)
    kysely-types.ts          DB type for Kysely, derived from schema.ts (Task 9b)
    database.ts              openDatabase → Db, runs migrations from drizzle/ (Task 9b)
    types.ts                 Category, Game, Suggestion, LfgPost, SetupKey (Tasks 5–6)
    repos/                   one repo per area + index.ts with createRepos → Repos (Task 9b)
drizzle/                     generated SQL migrations + drizzle-kit snapshots, committed (Task 9b)
drizzle.config.ts            drizzle-kit settings (Task 9b)
  discord/
    gateway.ts               Gateway interface (Task 7)
    discord-gateway.ts       discord.js implementation (Task 7)
  services/
    context.ts               AppContext (Task 8)
    audit.ts                 formatAuditLine, createAudit (Task 8)
    games.ts                 game admin operations (Task 9)
    membership.ts            joins, leaves, lookups (Task 10)
    suggestions.ts           (Task 11)
    lfg.ts                   (Task 12)
    setup.ts                 (Task 13)
    backup.ts, heartbeat.ts  (Task 14)
  interactions/
    custom-ids.ts            encode/parse (Task 15)
    commands.ts              command definitions + registration (Task 15)
    router.ts                dispatch + admin guard + error handling (Task 15)
    member.ts, suggest.ts, lfg.ts, admin.ts   handlers (Tasks 16–19)
  views/
    limits.ts                countComponents, truncate (Task 16)
    member.ts, suggestions.ts, lfg.ts, admin.ts   payload builders (Tasks 16–19)
tests/                       mirrors src/, plus tests/fakes/fake-gateway.ts and tests/fakes/context.ts
```

---

### Task 1: Toolchain scaffold

**Files:**
- Create: `package.json`, `pnpm-lock.yaml` (generated), `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/constants.ts`
- Test: `tests/toolchain.test.ts`

**Interfaces:**
- Produces: the scripts `pnpm typecheck | lint | format | format:check | test | check | dev | start`, and `src/constants.ts` exporting `PANEL_CHANNEL_NAME = "game-roles"`, `NEWS_CHANNEL_NAME = "game-news"`, `ADMIN_CATEGORY_NAME = "Bot admin"`, `ADMIN_CHANNEL_NAME = "bot-admin"`, `LOG_CHANNEL_NAME = "bot-log"`, `BACKUPS_CHANNEL_NAME = "bot-backups"`, `TEMPLATE_ROLE_NAME = "Game role template"`, `STARTING_CATEGORIES = ["Competitive", "Chill", "IRL activities"] as const`, `MAX_PENDING_SUGGESTIONS = 10`, `BACKUP_RETENTION_DAYS = 30`, `HEARTBEAT_INTERVAL_MS = 300_000`, `SELECT_OPTION_LIMIT = 25`, `COMPONENT_LIMIT = 40`, `TEXT_LIMIT = 100`.

- [ ] **Step 1: Write `.gitignore` before anything else**

The repo already exists on `main`, with a placeholder README and a repo-local noreply commit identity. Don't change the identity.

It must cover `.env`, `.env.*` (but keep `!.env.example`), `data/`, `*.sqlite*`, `backups/`, `node_modules/`, `migration/` and `mapping*.json`. The spec requires this before the first commit.

- [ ] **Step 2: Write `package.json`**

Set `"type": "module"`, `"private": true`, `"engines": {"node": ">=26"}`, `"packageManager": "pnpm@12.18.0"`, and the exact versions from Global Constraints. Scripts:

```json
{
  "typecheck": "tsc -p .",
  "lint": "oxlint --type-aware --deny-warnings",
  "format": "oxfmt",
  "format:check": "oxfmt --check",
  "test": "vitest run",
  "check": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test",
  "dev": "node --env-file=.env --watch src/main.ts",
  "start": "node src/main.ts"
}
```

Run `pnpm install`. The lockfile must be committed.

- [ ] **Step 3: Write `tsconfig.json`**

Set `noEmit`, `target: "esnext"`, `module: "nodenext"`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `types: ["node"]`, `skipLibCheck`. Include `src`, `tests`, `vitest.config.ts`.

- [ ] **Step 4: Write the lint, format and test configs**

`.oxlintrc.json`: plugins `typescript`, `unicorn`, `import`, `vitest`; category `correctness` set to `error`; `typescript/no-floating-promises` set to `error`.

`.oxfmtrc.json`: defaults.

`vitest.config.ts`: `test.include: ["tests/**/*.test.ts"]`.

- [ ] **Step 5: Write `.env.example`**

Placeholder values only:

```
DISCORD_TOKEN=replace-me
DISCORD_APPLICATION_ID=000000000000000000
DISCORD_GUILD_ID=000000000000000000
ADMIN_ROLE_ID=000000000000000000
HEALTHCHECK_URL=
DATABASE_PATH=data/bot.sqlite
BACKUP_HOUR_UTC=4
```

- [ ] **Step 6: Write `tests/toolchain.test.ts`, then `src/constants.ts`**

```ts
import { STARTING_CATEGORIES, MAX_PENDING_SUGGESTIONS } from "../src/constants.ts";
test("runs on Node 26+", () => { expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(26); });
test("constants match the spec", () => {
  expect(STARTING_CATEGORIES).toEqual(["Competitive", "Chill", "IRL activities"]);
  expect(MAX_PENDING_SUGGESTIONS).toBe(10);
});
```

- [ ] **Step 7: Verify the toolchain**

Run `pnpm check`. Expected: type-check, lint and format all clean, and 2 tests pass.

Then add a temporary `enum X { A }` to `src/constants.ts` and run `pnpm typecheck`. Expected: an `erasableSyntaxOnly` error. Remove the enum.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold TypeScript 7 / Node 26 toolchain"
```

---

### Task 2: Config and user-facing errors

**Files:**
- Create: `src/config.ts`, `src/errors.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { token: string; applicationId: string; guildId: string; adminRoleId: string; healthcheckUrl: string | null; databasePath: string; backupHourUtc: number }`
  - `loadConfig(env: Record<string, string | undefined>): Config`
  - `class UserFacingError extends Error`. Its `message` is shown to the member as is.

- [ ] **Step 1: Write the failing tests**

```ts
const valid = { DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: "100000000000000001", DISCORD_GUILD_ID: "100000000000000002", ADMIN_ROLE_ID: "100000000000000003" };
test("defaults", () => {
  expect(loadConfig(valid)).toMatchObject({ healthcheckUrl: null, databasePath: "data/bot.sqlite", backupHourUtc: 4 });
});
test("lists every missing variable at once", () => {
  expect(() => loadConfig({})).toThrow(/DISCORD_TOKEN.*DISCORD_APPLICATION_ID.*DISCORD_GUILD_ID.*ADMIN_ROLE_ID/s);
});
test("rejects non-snowflake IDs", () => {
  expect(() => loadConfig({ ...valid, DISCORD_GUILD_ID: "abc" })).toThrow(/DISCORD_GUILD_ID/);
});
test("empty HEALTHCHECK_URL means none; non-https is rejected", () => {
  expect(loadConfig({ ...valid, HEALTHCHECK_URL: "" }).healthcheckUrl).toBeNull();
  expect(() => loadConfig({ ...valid, HEALTHCHECK_URL: "http://x" })).toThrow(/HEALTHCHECK_URL/);
});
test("BACKUP_HOUR_UTC must be 0–23", () => {
  expect(() => loadConfig({ ...valid, BACKUP_HOUR_UTC: "24" })).toThrow(/BACKUP_HOUR_UTC/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run `pnpm vitest run tests/config.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `loadConfig` and `UserFacingError`**

A snowflake is `/^\d{17,20}$/`. Error messages name the variable but never echo its value, because the token must not reach the logs.

- [ ] **Step 4: Run the tests to verify they pass**

Run `pnpm vitest run tests/config.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: load and validate per-environment config"`

---

### Task 3: Normalization and game search

**Files:**
- Create: `src/domain/search.ts`
- Test: `tests/domain/search.test.ts`

**Interfaces:**
- Produces:
  - `normalize(text: string): string`
  - `interface Searchable { name: string; aliases: readonly string[] }`
  - `matchTier(query: string, item: Searchable): 0 | 1 | 2 | 3 | 4 | null`. The tiers are 0 starts with, 1 start of any word, 2 anywhere, 3 typo, 4 acronym.
  - `rankGames<T extends Searchable>(query: string, items: readonly T[], limit?: number): T[]`. `limit` defaults to 25.
  - `findCloseMatches<T extends Searchable>(name: string, items: readonly T[]): T[]`
  - `parseAliases(raw: string): string[]`
  - `editDistance(a: string, b: string): number`

- [ ] **Step 1: Write the failing tests**

```ts
const g = (name: string, aliases: string[] = []) => ({ name, aliases });
const games = [g("Valheim"), g("Minecraft"), g("Red Dead Redemption 2"), g("Call of Duty", ["cod"]),
  g("World of Warcraft", ["wow"]), g("Dungeons & Dragons"), g("Pokémon Go"), g("Among Us")];

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
  expect(rankGames("o", games).map((x) => x.name).slice(0, 2)).toEqual(["Among Us", "Call of Duty"]); // word-start tier, A→Z
  expect(rankGames("", games, 3)).toHaveLength(3);
});
test("typos need ≥3 chars", () => { expect(matchTier("vx", g("Valheim"))).toBeNull(); });
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
```

- [ ] **Step 2: Run them to verify they fail**

Run `pnpm vitest run tests/domain/search.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the module**

`normalize`, in order:
1. NFKD, then strip `\p{M}`.
2. Lower-case.
3. `&` becomes ` and `.
4. Remove apostrophes.
5. Every other non-`[a-z0-9]` character becomes a space.
6. Collapse runs of spaces and trim.

`editDistance` is optimal string alignment, so an adjacent swap counts as 1.

Typo tier: the query has at least 3 characters, and the smallest distance is ≤ (query length ≤ 5 ? 1 : 2). The smallest distance is taken over the whole name, each word, and the name's prefix of the query's length.

Acronym: the first letter of each alphabetic word, plus digit words whole ("red dead redemption 2" → "rdr2").

For each item, the tier is the best tier over its name and aliases.

An empty normalized query returns `[]` from `matchTier`. `rankGames` treats `""` as "no filter" and returns items in their given order, so callers can pre-sort by popularity.

`findCloseMatches` returns an item when any of these holds:
- its normalized name or an alias equals the normalized input;
- the two are equal once spaces are removed;
- the edit distance is within the typo threshold;
- the input equals the item's acronym.

- [ ] **Step 4: Run the tests to verify they pass**

Run `pnpm vitest run tests/domain/search.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: tiered game search with aliases, typos and acronyms"`

---

### Task 4: Role and permission rules

**Files:**
- Create: `src/domain/roles.ts`
- Test: `tests/domain/roles.test.ts`

**Interfaces:**
- Consumes: `normalize` (Task 3), `UserFacingError` (Task 2), `SELECT_OPTION_LIMIT` and `TEXT_LIMIT` (Task 1)
- Produces:
  - `diffSelection(shownRoleIds: readonly string[], currentRoleIds: ReadonlySet<string>, selectedRoleIds: readonly string[]): { add: string[]; remove: string[] }`
  - `computeRoleOrder(roles: readonly { id: string; position: number }[], templateId: string, gameRoleIdsAlphabetical: readonly string[]): { id: string; position: number }[]`. It returns only the roles whose position changes.
  - `chunk<T>(items: readonly T[], size: number): T[][]`
  - `isAdmin(memberRoleIds: ReadonlySet<string>, adminRoleId: string): boolean`
  - `validateGameName(raw: string): string`. It returns the trimmed, space-collapsed display name, or throws `UserFacingError`.

- [ ] **Step 1: Write the failing tests**

```ts
test("diff only touches roles shown in that dropdown", () => {
  const shown = ["a", "b", "c"]; const current = new Set(["a", "x"]); // x is another category's role
  expect(diffSelection(shown, current, ["b"])).toEqual({ add: ["b"], remove: ["a"] });
});
test("selections not shown (stale or forged) are ignored", () => {
  expect(diffSelection(["a"], new Set(), ["a", "zzz"])).toEqual({ add: ["a"], remove: [] });
});
test("empty selection removes all shown roles the member has", () => {
  expect(diffSelection(["a", "b"], new Set(["a", "b"]), [])).toEqual({ add: [], remove: ["a", "b"] });
});
test("game roles go directly below the template, A→Z, top to bottom", () => {
  const roles = [{ id: "everyone", position: 0 }, { id: "member", position: 5 }, { id: "tpl", position: 4 },
    { id: "zelda", position: 3 }, { id: "other", position: 2 }, { id: "apex", position: 1 }];
  const changes = computeRoleOrder(roles, "tpl", ["apex", "zelda"]);
  const after = new Map(roles.map((r) => [r.id, r.position]));
  for (const c of changes) after.set(c.id, c.position);
  const order = [...after].filter(([id]) => id !== "everyone").sort((a, b) => b[1] - a[1]).map(([id]) => id);
  expect(order).toEqual(["member", "tpl", "apex", "zelda", "other"]);
  expect(changes.some((c) => c.id === "member" || c.id === "everyone")).toBe(false);
});
test("already sorted → no changes", () => {
  expect(computeRoleOrder([{ id: "tpl", position: 3 }, { id: "a", position: 2 }, { id: "b", position: 1 }], "tpl", ["a", "b"])).toEqual([]);
});
test("chunk", () => { expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]); expect(chunk([], 25)).toEqual([]); });
test("isAdmin", () => { expect(isAdmin(new Set(["r1"]), "r1")).toBe(true); expect(isAdmin(new Set(), "r1")).toBe(false); });
test("validateGameName", () => {
  expect(validateGameName("  Deep   Rock  ")).toBe("Deep Rock");
  expect(() => validateGameName("!!!")).toThrow(UserFacingError);
  expect(() => validateGameName("x".repeat(101))).toThrow(/100/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run `pnpm vitest run tests/domain/roles.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the module**

`computeRoleOrder`:
1. Sort the roles top to bottom (position descending). Leave out position-0 roles: that's @everyone, which never moves.
2. Remove the game roles from the list.
3. Insert them right after the template, in the given order.
4. Re-number so the bottom role is 1.
5. Return only the entries whose position differs.

`validateGameName` throws "Game names need at least one letter or number." and "Game names can be at most 100 characters."

- [ ] **Step 4: Run the tests to verify they pass**

Run `pnpm vitest run tests/domain/roles.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: role diff, ordering and validation rules"`

---

### Task 5: Database, categories, games and setup records

**Files:**
- Create: `src/db/database.ts`, `src/db/types.ts`, `src/db/repos.ts`
- Test: `tests/db/games.test.ts`

**Interfaces:**
- Consumes: `normalize`, `parseAliases` (Task 3)
- Produces:
  - `openDatabase(path: string): DatabaseSync`. It accepts `":memory:"`, applies the migrations, and enables WAL (except for memory), `foreign_keys` and `busy_timeout = 5000`.
  - `types.ts`:
    - `Category { id: number; name: string; position: number }`
    - `Game { id: number; name: string; categoryId: number; roleId: string; aliases: string[]; addedBy: string; addedAt: string }`
    - `SetupKey = "templateRoleId" | "panelChannelId" | "panelMessageId" | "newsChannelId" | "adminCategoryId" | "adminChannelId" | "logChannelId" | "backupsChannelId"`
  - `createRepos(db: DatabaseSync): Repos`, where `Repos = { categories, games, setup, suggestions, lfg }` (the last two come in Task 6):
    - `categories`: `list(): Category[]` (by position), `get(id): Category | undefined`, `add(name): Category` (appended last), `rename(id, name): void`, `move(id, dir: "up" | "down"): void` (swaps with its neighbor; no-op at the ends)
    - `games`: `list(): Game[]` (by normalized name), `get(id)`, `byRoleId(roleId)`, `byNormalizedName(name)`, `add(input: Omit<Game, "id">): Game`, `update(id, patch: Partial<Pick<Game, "name" | "categoryId" | "aliases">>): Game`, `remove(id): void`, `ownsRole(roleId): boolean`
    - `setup`: `get(key: SetupKey): string | undefined`, `set(key, value): void`, `all(): Partial<Record<SetupKey, string>>`

- [ ] **Step 1: Write the failing tests**

All tests use `openDatabase(":memory:")`.

```ts
test("migrations are idempotent", () => { const db = openDatabase(":memory:"); expect(() => migrate(db)).not.toThrow(); });
test("categories keep display order and move", () => {
  const r = createRepos(openDatabase(":memory:"));
  const [a, b] = [r.categories.add("Competitive"), r.categories.add("Chill")];
  r.categories.move(b.id, "up");
  expect(r.categories.list().map((c) => c.name)).toEqual(["Chill", "Competitive"]);
  r.categories.move(b.id, "up"); // already first → no-op
  expect(r.categories.list()[0]?.id).toBe(b.id);
});
test("games round-trip with aliases and are listed A→Z by normalized name", () => { /* add "valheim", "Among Us" → list order Among Us, valheim; aliases preserved */ });
test("a duplicate normalized name is rejected by the database", () => {
  // add "Pokémon Go" then "pokemon go!" → throws
});
test("ownsRole is true only for roles in the games table", () => { /* ownsRole(role of a game) true; ownsRole("999") false */ });
test("removing a game removes its aliases", () => {});
test("setup keys round-trip", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

Run `pnpm vitest run tests/db/games.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the migrations and repos**

Migrations are an array of SQL strings applied by `PRAGMA user_version`. Also export `migrate(db)`. Migration 1:

```sql
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL);
CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id), role_id TEXT NOT NULL UNIQUE,
  added_by TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE game_aliases (game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  alias TEXT NOT NULL, PRIMARY KEY (game_id, alias));
CREATE TABLE setup (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Timestamps are ISO-8601 UTC strings. Aliases are stored already normalized.

- [ ] **Step 4: Run the tests to verify they pass**

Run `pnpm vitest run tests/db/games.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: SQLite schema and repos for categories, games and setup"`

---

### Task 6: Suggestion and LFG records

**Files:**
- Modify: `src/db/database.ts` (migration 2), `src/db/types.ts`, `src/db/repos.ts`
- Test: `tests/db/suggestions-lfg.test.ts`

**Interfaces:**
- Produces:
  - `SuggestionStatus = "pending" | "approved" | "rejected" | "withdrawn"`
  - `Suggestion { id; suggesterId; name; categoryId; note: string | null; status; reviewerId: string | null; rejectionReason: string | null; decidedAt: string | null; createdAt; reviewMessageId: string | null; gameId: number | null }`
  - `LfgPost { messageId; channelId; gameId: number | null; gameName: string; authorId; when: string | null; note: string | null; createdAt; in: string[]; maybe: string[] }`
  - `repos.suggestions`:
    - `add({ suggesterId, name, categoryId, note, createdAt }): Suggestion`
    - `get(id)`
    - `listByUser(userId)` (newest first)
    - `listPending()` (oldest first)
    - `countPending(userId): number`
    - `pendingNames(): { id: number; name: string }[]`
    - `decide(id, to: Exclude<SuggestionStatus, "pending">, by: string, at: string, reason?: string): boolean`. It is atomic (`WHERE status = 'pending'`) and returns false if the suggestion was already decided.
    - `undoDecision(id): void`
    - `update(id, patch: Partial<Pick<Suggestion, "name" | "categoryId" | "note">>)`
    - `setReviewMessage(id, messageId)`
    - `setGame(id, gameId)`
  - `repos.lfg`:
    - `add(post: Omit<LfgPost, "in" | "maybe">): void`
    - `get(messageId): LfgPost | undefined`
    - `setResponse(messageId, userId, kind: "in" | "maybe" | null): void`

- [ ] **Step 1: Write the failing tests**

```ts
test("decide is first-wins", () => {
  const s = r.suggestions.add({ suggesterId: U1, name: "Valheim", categoryId: c.id, note: null, createdAt: T0 });
  expect(r.suggestions.decide(s.id, "approved", ADMIN_A, T1)).toBe(true);
  expect(r.suggestions.decide(s.id, "rejected", ADMIN_B, T1, "no")).toBe(false);
  expect(r.suggestions.get(s.id)).toMatchObject({ status: "approved", reviewerId: ADMIN_A, rejectionReason: null });
});
test("undoDecision returns it to pending and clears reviewer fields", () => {});
test("countPending counts only that user's pending suggestions", () => {});
test("LFG responses: setting maybe after in replaces it; null clears", () => {
  r.lfg.add({ messageId: M1, channelId: CH, gameId: game.id, gameName: game.name, authorId: U1, when: "tonight 9pm", note: null, createdAt: T0 });
  r.lfg.setResponse(M1, U2, "in"); r.lfg.setResponse(M1, U2, "maybe");
  expect(r.lfg.get(M1)).toMatchObject({ in: [], maybe: [U2] });
  r.lfg.setResponse(M1, U2, null);
  expect(r.lfg.get(M1)).toMatchObject({ in: [], maybe: [] });
});
test("removing a game keeps its LFG posts, with gameId null and gameName kept", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

Run `pnpm vitest run tests/db/suggestions-lfg.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement migration 2 and the two repos**

Migration 2:
- `suggestions`: a `CHECK` on status, and `game_id` referencing `games ON DELETE SET NULL`.
- `lfg_posts`: `game_id` referencing `games ON DELETE SET NULL`, with `game_name` kept.
- `lfg_responses`: `(message_id, user_id)` primary key, `kind CHECK IN ('in', 'maybe')`, and `responded_at`. Lists come back in response order.

- [ ] **Step 4: Run all tests to verify they pass**

Run `pnpm vitest run tests/db`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: suggestion and LFG records"`

---

### Task 7: Discord gateway

**Files:**
- Create: `src/discord/gateway.ts`, `src/discord/discord-gateway.ts`, `tests/fakes/fake-gateway.ts`
- Test: `tests/fakes/fake-gateway.test.ts`

**Interfaces:**
- Produces `Gateway` (in `gateway.ts`):

```ts
export interface RoleSnapshot { id: string; name: string; position: number; color: number; mentionable: boolean }
export interface Overwrite { id: string; allow: PermissionsString[]; deny: PermissionsString[] }
export type Payload = MessageCreateOptions;              // discord.js type, import type only
export interface OwnMessage { id: string; createdAt: Date; hasAttachment: boolean }
export interface Gateway {
  readonly guildId: string; readonly botUserId: string;
  role(id: string): RoleSnapshot | undefined;
  roles(): RoleSnapshot[];
  createRole(o: { name: string; color: number; mentionable: boolean }, reason: string): Promise<RoleSnapshot>;
  editRole(id: string, patch: Partial<Pick<RoleSnapshot, "name" | "color" | "mentionable">>, reason: string): Promise<void>;
  deleteRole(id: string, reason: string): Promise<void>;
  setRolePositions(changes: readonly { id: string; position: number }[], reason: string): Promise<void>;
  botTopRolePosition(): number;
  missingBotPermissions(required: readonly PermissionsString[]): PermissionsString[];
  memberRoleIds(userId: string): ReadonlySet<string>;     // empty set if not cached
  roleMemberIds(roleId: string): string[];
  addMemberRole(userId: string, roleId: string, reason: string): Promise<void>;
  removeMemberRole(userId: string, roleId: string, reason: string): Promise<void>;
  channelExists(id: string): boolean;
  createCategory(name: string, overwrites: readonly Overwrite[]): Promise<string>;
  createTextChannel(name: string, parentId: string | null, overwrites: readonly Overwrite[]): Promise<string>;
  send(channelId: string, payload: Payload): Promise<string>;           // → message ID
  edit(channelId: string, messageId: string, payload: Payload): Promise<boolean>; // false if gone
  ownMessages(channelId: string, limit: number): Promise<OwnMessage[]>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
}
```

- Produces `createDiscordGateway(client: Client<true>, guildId: string): Gateway` in `discord-gateway.ts`.
- Produces `FakeGateway implements Gateway` in `tests/fakes/fake-gateway.ts`. It keeps roles, members, channels and messages in memory. Every mutating call is recorded in `calls: { method: string; args: unknown[] }[]`. Test helpers: `addMember(userId, roleIds)`, `setBotTopPosition(n)`, `removeRoleBehindBotsBack(id)`, `failNext(method, error)`.

- [ ] **Step 1: Write the failing tests for the fake**

The fake is used by every service test, so it gets tests of its own:

```ts
test("createRole puts the new role at position 1 and shifts others up", () => {});
test("deleteRole removes it from every member", () => {});
test("edit of a deleted message returns false", () => {});
test("failNext makes the next call to that method reject once", () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement the fake, then run them to verify they pass**

Run `pnpm vitest run tests/fakes`.

- [ ] **Step 3: Implement `createDiscordGateway`**

This uses the discord.js cache: `guild.roles.cache`, `guild.members.cache`, `role.members`, and `guild.members.me` for permissions and the top role. `ownMessages` filters `channel.messages.fetch({ limit })` by author.

Map `Overwrite.id === "everyone"` to `guild.id`.

`edit` returns false on Discord error code 10008 (unknown message).

It has no unit test. `pnpm typecheck` is its check.

- [ ] **Step 4: Verify**

Run `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: thin Discord gateway and in-memory fake"`

---

### Task 8: App context, audit log and admin notices

**Files:**
- Create: `src/services/context.ts`, `src/services/audit.ts`, `tests/fakes/context.ts`
- Test: `tests/services/audit.test.ts`

**Interfaces:**
- Consumes: `Repos` (Tasks 5–6), `Gateway` (Task 7), `Config` (Task 2)
- Produces:
  - `type Source = "panel" | "command" | "lfg"`
  - `type AuditEvent`, a union:
    - `{ kind: "joined" | "left"; userId; game: string; source: Source }`
    - `{ kind: "suggested"; userId; name: string }`
    - `{ kind: "suggestion-approved" | "suggestion-rejected" | "suggestion-edited" | "suggestion-withdrawn"; userId; name: string; reason?: string }`
    - `{ kind: "game-added" | "game-removed"; userId; game: string }`
    - `{ kind: "game-edited"; userId; game: string; changes: string }`
    - `{ kind: "category-changed"; userId; detail: string }`
    - `{ kind: "template-reapplied"; userId; count: number }`
    - `{ kind: "backup"; userId: string | null; file: string }`
    - `{ kind: "setup"; userId; detail: string }`
  - `formatAuditLine(e: AuditEvent): string`. Users appear as `<@id>`. All user-typed text goes through `escapeMarkdown` and has `@` replaced by `@​`.
  - `interface Audit { log(e: AuditEvent): Promise<void>; notifyAdmins(text: string): Promise<void> }`
  - `createAudit(repos: Repos, gateway: Gateway): Audit`. It posts to the recorded `logChannelId` / `adminChannelId` with `allowedMentions: { parse: [] }`. If a channel isn't recorded yet, it falls back to `console.log`. It never throws: failures go to `console.error`.
  - `interface AppContext { config: Config; repos: Repos; gateway: Gateway; audit: Audit; now: () => Date }`
  - Test helper: `makeContext(overrides?): AppContext & { gateway: FakeGateway; logLines: string[]; adminNotices: string[] }`. It uses an in-memory database and the starting categories. It records a template role (exported `TEMPLATE_COLOR = 0x5865f2`, `templatePosition`) and every setup channel, and sets the bot's top position above the template.
  - Also in `tests/fakes/context.ts`: `sentTo(ctx, key: SetupKey): Payload[]` (messages sent to that recorded channel) and `lastSend(ctx): { channelId: string; payload: Payload }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("join line names user, game and source", () => {
  expect(formatAuditLine({ kind: "joined", userId: U1, game: "Valheim", source: "lfg" })).toBe(`<@${U1}> joined **Valheim** (LFG post)`);
});
test("rejection line includes reviewer and reason", () => {
  expect(formatAuditLine({ kind: "suggestion-rejected", userId: A1, name: "Foo", reason: "dupe" })).toBe(`<@${A1}> rejected suggestion **Foo**: dupe`);
});
test("user text can't ping or format", () => {
  expect(formatAuditLine({ kind: "suggested", userId: U1, name: "@everyone **x**" })).not.toMatch(/@everyone|\*\*x\*\*/);
});
test("log posts to #bot-log with no mentions allowed", async () => { /* fake.calls send → payload.allowedMentions = { parse: [] } */ });
test("log never throws when Discord fails", async () => { /* failNext("send") → resolves */ });
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/services/audit.test.ts`.

The source labels are `panel` → "panel", `command` → "command" and `lfg` → "LFG post". Write one line per event kind, each a short sentence in the style above.

- [ ] **Step 3: Commit**

`git commit -m "feat: audit lines to #bot-log and notices to #bot-admin"`

---

### Task 9: Game administration service

**Files:**
- Create: `src/services/games.ts`
- Test: `tests/services/games.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `validateGameName`, `parseAliases`, `computeRoleOrder`, `findCloseMatches`
- Produces:
  - `addGame(ctx, input: { name: string; categoryId: number; aliases: string; actorId: string }): Promise<Game>`
  - `editGame(ctx, gameId: number, patch: { name?: string; categoryId?: number; aliases?: string }, actorId: string): Promise<Game>`
  - `removeGame(ctx, gameId: number, actorId: string): Promise<{ game: Game; hadMembers: number }>`
  - `reapplyTemplate(ctx, actorId: string): Promise<number>`, which returns the count of roles updated
  - `sortGameRoles(ctx): Promise<void>`
  - `assertCanManageRoles(ctx): RoleSnapshot`, which returns the template or throws `UserFacingError`

- [ ] **Step 1: Write the failing tests**

All use `makeContext()`.

```ts
test("addGame copies template color + mentionable, stores the role, sorts, logs", async () => {
  const game = await addGame(ctx, { name: "Valheim", categoryId: chill.id, aliases: "vh", actorId: A1 });
  const role = ctx.gateway.role(game.roleId)!;
  expect(role).toMatchObject({ name: "Valheim", color: TEMPLATE_COLOR, mentionable: true });
  expect(ctx.repos.games.ownsRole(game.roleId)).toBe(true);
  expect(ctx.logLines).toContain(`<@${A1}> added game **Valheim**`);
});
test("addGame refuses a name or alias that collides with an existing game", async () => {
  await addGame(ctx, { name: "Valheim", categoryId: chill.id, aliases: "", actorId: A1 });
  await expect(addGame(ctx, { name: "valheim!", categoryId: chill.id, aliases: "", actorId: A1 })).rejects.toThrow(UserFacingError);
});
test("bot below the template → exact fix, nothing created", async () => {
  ctx.gateway.setBotTopPosition(templatePosition - 1);
  await expect(addGame(ctx, { name: "Valheim", categoryId: chill.id, aliases: "", actorId: A1 }))
    .rejects.toThrow("Move the bot's role above Game role template in Server Settings → Roles");
  expect(ctx.gateway.calls.filter((c) => c.method === "createRole")).toHaveLength(0);
});
test("missing Manage Roles → exact fix", async () => { /* missingBotPermissions → ["ManageRoles"]; message names "Manage Roles" */ });
test("no template recorded → 'Run /gameadmin setup first.'", async () => {});
test("Discord fails after createRole → the role is deleted again and no row is stored", async () => {});
test("rename renames the role and re-sorts", async () => {});
test("removeGame deletes only that game's role and its row", async () => {
  const other = await ctx.gateway.createRole({ name: "Not ours", color: 0, mentionable: false }, "t");
  const { game } = await removeGame(ctx, valheim.id, A1);
  const deleted = ctx.gateway.calls.filter((c) => c.method === "deleteRole").map((c) => c.args[0]);
  expect(deleted).toEqual([game.roleId]);
  expect(ctx.gateway.role(other.id)).toBeDefined();
});
test("removeGame when the role was already deleted by hand still removes the row", async () => {
  ctx.gateway.removeRoleBehindBotsBack(valheim.roleId);
  await removeGame(ctx, valheim.id, A1);
  expect(ctx.repos.games.get(valheim.id)).toBeUndefined();
});
test("reapplyTemplate edits only game roles", async () => {});
```

- [ ] **Step 2: Run them to verify they fail**

Run `pnpm vitest run tests/services/games.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the service**

`assertCanManageRoles` checks, in order:
1. The template is recorded and exists.
2. `ManageRoles` is not missing.
3. `botTopRolePosition() > template.position`.

Each failure throws its fix as a `UserFacingError`.

Every Discord write passes an audit-log `reason` such as `"Game added by <id>"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run `pnpm vitest run tests/services/games.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add, edit, remove games and re-apply template"`

---

### Task 9b: Drizzle schema, generated migrations and Kysely repos

This replaces the database layer built in Tasks 5 and 6. The user chose better-sqlite3, Drizzle and Kysely after Task 9. No database has been deployed yet, so the old hand-written migrations are deleted and replaced by one generated initial migration. Repo names, method names, arguments and app types (`src/db/types.ts`) stay the same. Only the return types become `Promise`s.

**Files:**
- Create: `src/db/schema.ts`, `src/db/kysely-types.ts`, `drizzle.config.ts`, `drizzle/` (generated), `src/db/repos/categories.ts`, `src/db/repos/games.ts`, `src/db/repos/setup.ts`, `src/db/repos/suggestions.ts`, `src/db/repos/lfg.ts`, `src/db/repos/index.ts`, `scripts/check-migrations.ts`
- Modify: `package.json`, `src/db/database.ts`, `tests/db/*.test.ts`, `tests/fakes/context.ts`, `src/services/games.ts`, `tests/services/games.test.ts`, `src/services/audit.ts` (if it reads repos)
- Delete: `src/db/repos.ts`
- Test: `tests/db/database.test.ts`, plus the existing `tests/db/*.test.ts`, which now `await`

**Interfaces:**
- Produces:
  - `src/db/schema.ts`: Drizzle `sqliteTable` definitions for `categories`, `games`, `game_aliases`, `setup`, `suggestions`, `lfg_posts` and `lfg_responses`. They have exactly the columns and constraints of Tasks 5–6's migrations: the UNIQUE columns, the CHECKs on `suggestions.status` and `lfg_responses.kind`, `ON DELETE CASCADE` on aliases and responses, `ON DELETE SET NULL` on both `game_id`s, the composite primary keys, and the `suggestions_by_user` index. Database column names stay snake_case.
  - `src/db/kysely-types.ts`: `export interface DB { categories: Kyselify<typeof categories>; … }`, one entry per table, using `Kyselify` from `drizzle-orm/kysely`.
  - `src/db/database.ts`:
    - `interface Db { sqlite: Database; kysely: Kysely<DB> }`, where `Database` is from better-sqlite3
    - `openDatabase(path: string): Db`. It sets `busy_timeout = 5000`, then WAL (except `":memory:"`), then `foreign_keys = ON`. It runs Drizzle's better-sqlite3 migrator on `drizzle/`, resolved from `import.meta.dirname` so it works from tests, `pnpm dev` and the container.
    - `closeDatabase(db: Db): Promise<void>`
  - `src/db/repos/index.ts`: `createRepos(kysely: Kysely<DB>): Repos`. `Repos` keeps the same members and method names as Tasks 5–6, now returning `Promise`s. `suggestions.decide` stays a single `UPDATE … WHERE id = ? AND status = 'pending'` and returns `numUpdatedRows > 0n`. Multi-row writes use `kysely.transaction()`.
  - Scripts:
    - `db:generate`: `drizzle-kit generate`
    - `db:check`: `node scripts/check-migrations.ts`. It runs `drizzle-kit generate` and fails with "Schema changed without a migration: run pnpm db:generate and commit drizzle/" if `git status --porcelain drizzle` is non-empty afterwards.
    - `check` becomes `pnpm typecheck && pnpm lint && pnpm format:check && pnpm db:check && pnpm test`.

- [ ] **Step 1: Install the pinned packages**

Install `better-sqlite3@13.0.3`, `kysely@0.29.8` and `drizzle-orm@0.45.4` as dependencies, and `drizzle-kit@0.31.11` and `@types/better-sqlite3@9.6.0` as dev dependencies, all exact. If pnpm's release-age protection blocks one, add it to `minimumReleaseAgeExclude` as Task 1 did. Confirm better-sqlite3 loads: `node -e "new (require('better-sqlite3'))(':memory:'); console.log('ok')"`.

- [ ] **Step 2: Write `src/db/schema.ts` and `drizzle.config.ts`, then run `pnpm db:generate`**

`drizzle.config.ts`: `dialect: "sqlite"`, `schema: "./src/db/schema.ts"`, `out: "./drizzle"`.

Read the generated `drizzle/0000_*.sql` before going on.

- [ ] **Step 3: Verify the generated schema matches the old one**

Run the old migrations (from `git show HEAD:src/db/database.ts`) on one scratch file and the new migration on another. Compare `PRAGMA table_info`, `PRAGMA foreign_key_list` and `PRAGMA index_list` for every table, plus the CHECK clauses in `sqlite_master`. Expected: no differences apart from Drizzle's own migrations table. Put the comparison output in the report. The comparison script is scratch: don't commit it.

- [ ] **Step 4: Write the failing database test**

```ts
test("openDatabase applies the generated migrations once", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "gr-")), "bot.sqlite");
  const first = openDatabase(path); await closeDatabase(first);
  const second = openDatabase(path);
  const applied = second.sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number };
  expect(applied.n).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);
  await closeDatabase(second);
});
test("foreign keys are enforced", async () => { /* inserting a game with an unknown category_id rejects */ });
```

Export `MIGRATIONS_DIR` from `database.ts` for this test.

- [ ] **Step 5: Rewrite the repos with Kysely, one file per area, and delete `src/db/repos.ts`**

Change the existing tests in `tests/db/` only to add `await`. Their assertions must not change. They prove the rewrite behaves the same.

- [ ] **Step 6: Update the callers**

`tests/fakes/context.ts` (`makeContext` may become `async`; if so, update every test that calls it), plus `src/services/games.ts` and its tests. Every repo call gets an `await`.

- [ ] **Step 7: Add `scripts/check-migrations.ts` and wire it into `check`**

Verify it both ways:
1. `pnpm db:check` passes on a clean tree.
2. Add a scratch column to `schema.ts`. `pnpm db:check` must fail with the message above.
3. Revert the column and delete the migration it generated.

- [ ] **Step 8: Run everything and commit**

Run `pnpm check`. Expected: every earlier test passes, plus the new database tests.

`git commit -m "refactor: Drizzle schema with generated migrations, Kysely repos on better-sqlite3"`

---

### Task 10: Membership service

**Files:**
- Create: `src/services/membership.ts`
- Test: `tests/services/membership.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `diffSelection`, `rankGames`
- Produces:
  - `applySelection(ctx, userId: string, shownGameIds: readonly number[], selectedGameIds: readonly string[], source: Source): Promise<{ added: Game[]; removed: Game[]; missing: Game[] }>`. Select values are game IDs as strings.
  - `join(ctx, userId, gameId: number, source: Source): Promise<"joined" | "already">`
  - `leave(ctx, userId, gameId: number, source: Source): Promise<"left" | "not-member">`
  - `gamesOf(ctx, userId): Game[]`
  - `whoPlays(ctx, gameId): string[]`
  - `gamesInCommon(ctx, a: string, b: string): Game[]`
  - `autocompleteGames(ctx, userId, query: string, mode: "add" | "remove" | "any"): Game[]`. It returns at most 25.

- [ ] **Step 1: Write the failing tests**

```ts
test("applySelection changes only the shown dropdown's games and logs each change", async () => {
  ctx.gateway.addMember(U1, [valheim.roleId, chess.roleId]); // chess is in another category
  const r = await applySelection(ctx, U1, [valheim.id, minecraft.id], [String(minecraft.id)], "panel");
  expect(r.added.map((g) => g.name)).toEqual(["Minecraft"]);
  expect(r.removed.map((g) => g.name)).toEqual(["Valheim"]);
  expect(ctx.gateway.memberRoleIds(U1).has(chess.roleId)).toBe(true);
  expect(ctx.logLines).toEqual([`<@${U1}> joined **Minecraft** (panel)`, `<@${U1}> left **Valheim** (panel)`]);
});
test("a game removed since the menu opened is ignored", async () => {});
test("a game whose role was deleted by hand → reported as missing, admins notified, others still applied", async () => {
  ctx.gateway.removeRoleBehindBotsBack(valheim.roleId);
  const r = await applySelection(ctx, U1, [valheim.id, minecraft.id], [String(valheim.id), String(minecraft.id)], "panel");
  expect(r.missing.map((g) => g.name)).toEqual(["Valheim"]);
  expect(r.added.map((g) => g.name)).toEqual(["Minecraft"]);
  expect(ctx.adminNotices.some((n) => n.includes("Valheim"))).toBe(true);
});
test("join twice → 'already', one log line", async () => {});
test("autocomplete add hides owned; remove shows only owned; empty add query = most members first", async () => {});
test("gamesInCommon", async () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/services/membership.test.ts`.

`join` on a missing role throws `UserFacingError("That game's role is missing; the admins have been told.")` after calling `notifyAdmins`.

Empty-query popularity is `roleMemberIds(roleId).length`, descending, then by name.

- [ ] **Step 3: Commit**

`git commit -m "feat: member joins, leaves and lookups"`

---

### Task 11: Suggestion service

**Files:**
- Create: `src/services/suggestions.ts`
- Test: `tests/services/suggestions.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `addGame` (Task 9), `join` (Task 10), `findCloseMatches`, `validateGameName`, `MAX_PENDING_SUGGESTIONS`. Also `reviewCardView(s, categoryName)` and `announcementView(game)` from Task 17. Write minimal versions here and finish them in Task 17.
- Produces:
  - `closeMatches(ctx, name: string): { games: Game[]; pending: { id: number; name: string }[] }`
  - `submitSuggestion(ctx, input: { userId: string; name: string; categoryId: number; note: string | null }): Promise<Suggestion>`
  - `approveSuggestion(ctx, id: number, adminId: string): Promise<Game>`
  - `editSuggestion(ctx, id: number, patch: { name?: string; categoryId?: number; aliases?: string }, adminId: string): Promise<Suggestion>`. Aliases are held in memory until approval, in a `Map<number, string>`.
  - `rejectSuggestion(ctx, id: number, adminId: string, reason: string): Promise<void>`
  - `withdrawSuggestion(ctx, id: number, userId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
test("submit posts a review card in #bot-admin and records its message", async () => {
  const s = await submitSuggestion(ctx, { userId: U1, name: "Valheim", categoryId: chill.id, note: null });
  expect(ctx.repos.suggestions.get(s.id)?.reviewMessageId).toBeTruthy();
  expect(ctx.logLines).toContain(`<@${U1}> suggested **Valheim**`);
});
test("11th pending suggestion is refused with the limit in the message", async () => {
  for (let i = 0; i < 10; i++) await submitSuggestion(ctx, { userId: U1, name: `Game ${i}`, categoryId: chill.id, note: null });
  await expect(submitSuggestion(ctx, { userId: U1, name: "Game 10", categoryId: chill.id, note: null })).rejects.toThrow(/10 pending/);
});
test("closeMatches finds games and pending suggestions", async () => {});
test("approve creates the game, adds the suggester, announces in #game-news, updates the card, logs", async () => {
  const game = await approveSuggestion(ctx, s.id, A1);
  expect(ctx.gateway.memberRoleIds(U1).has(game.roleId)).toBe(true);
  expect(sentTo(ctx, "newsChannelId")).toHaveLength(1);
  expect(ctx.repos.suggestions.get(s.id)).toMatchObject({ status: "approved", reviewerId: A1, gameId: game.id });
});
test("second approve (or reject) of the same card is refused, nothing created twice", async () => {
  await approveSuggestion(ctx, s.id, A1);
  await expect(approveSuggestion(ctx, s.id, A2)).rejects.toThrow("This suggestion was already approved.");
  await expect(rejectSuggestion(ctx, s.id, A2, "no")).rejects.toThrow("This suggestion was already approved.");
  expect(ctx.repos.games.list()).toHaveLength(1);
});
test("approve after withdraw is refused", async () => {});
test("approve fails in Discord → suggestion is pending again", async () => { /* failNext("createRole") */ });
test("edit changes name/category before approval; aliases carry into the game", async () => {});
test("reject stores the reason; withdraw only by the suggester and only while pending", async () => {});
test("withdraw marks the review card withdrawn and logs it", async () => { /* last edit of reviewMessageId has no buttons, text contains "Withdrawn" */ });
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/services/suggestions.test.ts`.

Approve flow:
1. Claim with `decide(..., "approved")`.
2. Run `addGame`. If it throws, call `undoDecision` and rethrow.
3. `setGame`.
4. `join(suggester, "panel")`. Skip it if they've left the server, i.e. the member isn't cached.
5. Announce.
6. Edit the card.
7. Log.

The refusal text is `This suggestion was already ${status}.`

- [ ] **Step 3: Commit**

`git commit -m "feat: suggestions with review, limits and first-wins decisions"`

---

### Task 12: LFG service

**Files:**
- Create: `src/domain/lfg.ts`, `src/services/lfg.ts`
- Test: `tests/domain/lfg.test.ts`, `tests/services/lfg.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `join` (Task 10), `removeGame` (Task 9, tests only), and `lfgPostView(post, game | null)` from Task 18 (minimal version here)
- Produces:
  - `toggleResponse(current: "in" | "maybe" | null, clicked: "in" | "maybe"): "in" | "maybe" | null`
  - `createLfgPost(ctx, input: { authorId; gameId: number; when: string | null; note: string | null; channelId: string }): Promise<string>`, which returns the message ID
  - `respondToLfg(ctx, messageId: string, userId: string, clicked: "in" | "maybe"): Promise<LfgPost>`
  - `joinFromLfg(ctx, messageId: string, userId: string): Promise<"joined" | "already">`

- [ ] **Step 1: Write the failing tests**

```ts
test("toggle", () => {
  expect(toggleResponse(null, "in")).toBe("in");
  expect(toggleResponse("in", "in")).toBeNull();
  expect(toggleResponse("in", "maybe")).toBe("maybe");
});
test("create pings only the game role and stores the post", async () => {
  const id = await createLfgPost(ctx, { authorId: U1, gameId: valheim.id, when: "tonight 9pm", note: "@everyone bring food", channelId: CH });
  const payload = lastSend(ctx).payload;
  expect(payload.allowedMentions).toEqual({ roles: [valheim.roleId], parse: [] });
  expect(ctx.repos.lfg.get(id)?.when).toBe("tonight 9pm");
});
test("respond re-renders the post with In/Maybe lists", async () => {});
test("join from post logs source 'LFG post'", async () => {});
test("buttons on a post whose game was removed answer 'This game has been removed.'", async () => {
  await removeGame(ctx, valheim.id, A1);
  await expect(respondToLfg(ctx, id, U2, "in")).rejects.toThrow("This game has been removed.");
  await expect(joinFromLfg(ctx, id, U2)).rejects.toThrow("This game has been removed.");
});
test("unknown post → UserFacingError, not a crash", async () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/domain/lfg.test.ts tests/services/lfg.test.ts`.

- [ ] **Step 3: Commit**

`git commit -m "feat: LFG posts with live In/Maybe headcount"`

---

### Task 13: Setup and panel service

**Files:**
- Create: `src/domain/setup-plan.ts`, `src/services/setup.ts`
- Test: `tests/domain/setup-plan.test.ts`, `tests/services/setup.test.ts`

**Interfaces:**
- Consumes: `AppContext`, constants, and `panelView()` from Task 16 (minimal version here)
- Produces:
  - `type SetupItem = "templateRole" | "panelChannel" | "newsChannel" | "adminCategory" | "adminChannel" | "logChannel" | "backupsChannel" | "categories" | "panelMessage"`
  - `planSetup(state: { recorded: Partial<Record<SetupKey, string>>; exists: (key: SetupKey) => boolean; categoryCount: number; panelMessageExists: boolean }): { create: SetupItem[]; fine: SetupItem[] }`. It returns items in dependency order.
  - `REQUIRED_PERMISSIONS: PermissionsString[]`: `ManageRoles`, `ManageChannels`, `ViewChannel`, `SendMessages`, `EmbedLinks`, `AttachFiles`, `ReadMessageHistory`
  - `checkSetup(ctx): string[]`, the problems to fix, each a full sentence
  - `previewSetup(ctx): Promise<{ problems: string[]; plan: ReturnType<typeof planSetup> }>`
  - `applySetup(ctx, actorId: string): Promise<{ created: SetupItem[]; fine: SetupItem[] }>`
  - `refreshPanel(ctx): Promise<"updated" | "reposted">`

- [ ] **Step 1: Write the failing tests**

```ts
test("fresh server → everything to create, in dependency order", () => {
  expect(planSetup({ recorded: {}, exists: () => false, categoryCount: 0, panelMessageExists: false }).create).toEqual(
    ["templateRole", "panelChannel", "newsChannel", "adminCategory", "adminChannel", "logChannel", "backupsChannel", "categories", "panelMessage"]);
});
test("recorded but deleted → recreated; existing → fine", () => {});
test("deleted admin category → its channels are recreated under the new category", () => {});
test("apply twice: second run creates nothing and reports all fine", async () => {
  await applySetup(ctx, A1);
  const before = ctx.gateway.calls.length;
  const second = await applySetup(ctx, A1);
  expect(second.created).toEqual([]);
  expect(ctx.gateway.calls.slice(before).filter((c) => c.method.startsWith("create"))).toEqual([]);
});
test("permissions: news + panel read-only for @everyone; admin category hidden except admin role and bot", async () => {
  // inspect createTextChannel/createCategory overwrites in fake.calls
});
test("checkSetup lists each missing permission and the role-position problem", () => {});
test("refreshPanel edits the existing message, reposts and records a new ID if deleted", async () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/domain/setup-plan.test.ts tests/services/setup.test.ts`.

Overwrites:
- Panel channel and `#game-news`: `everyone` gets allow `ViewChannel`, deny `SendMessages`, `CreatePublicThreads`, `AddReactions`; the bot gets allow `SendMessages`, `EmbedLinks`, `AttachFiles`.
- Admin category: `everyone` gets deny `ViewChannel`; the admin role gets allow `ViewChannel`; the bot gets allow `ViewChannel`, `SendMessages`, `AttachFiles`, `ReadMessageHistory`.
- Admin channels inherit the category's overwrites.

The template role is created with `color: 0`, `mentionable: true`, and no permissions (`permissions: []` in the real gateway).

- [ ] **Step 3: Commit**

`git commit -m "feat: idempotent /gameadmin setup and panel refresh"`

---

### Task 14: Backups, schedule and heartbeat

**Files:**
- Create: `src/domain/schedule.ts`, `src/services/backup.ts`, `src/services/heartbeat.ts`
- Test: `tests/domain/schedule.test.ts`, `tests/services/backup.test.ts`, `tests/services/heartbeat.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `Db` (Task 9b): `db.sqlite.backup(path)` from better-sqlite3
- Produces:
  - `msUntilNextRun(now: Date, hourUtc: number): number`. It is always > 0.
  - `selectExpiredBackups(messages: readonly OwnMessage[], now: Date, maxAgeDays: number): string[]`. Only messages with attachments count.
  - `runBackup(ctx, db: Db, actorId: string | null): Promise<{ file: string; pruned: number }>`
  - `scheduleNightlyBackups(ctx, db: Db): () => void`, which returns a cancel function
  - `startHeartbeat(opts: { url: string | null; intervalMs: number; isConnected: () => boolean; fetch?: typeof fetch }): () => void`

- [ ] **Step 1: Write the failing tests**

```ts
test("next run later today / tomorrow / exactly now → tomorrow", () => {
  expect(msUntilNextRun(new Date("2026-11-07T03:00:00Z"), 4)).toBe(3_600_000);
  expect(msUntilNextRun(new Date("2026-11-07T05:00:00Z"), 4)).toBe(23 * 3_600_000);
  expect(msUntilNextRun(new Date("2026-11-07T04:00:00Z"), 4)).toBe(24 * 3_600_000);
});
test("expired = older than 30 days, with attachment", () => {
  const now = new Date("2026-11-07T04:00:00Z");
  const msgs = [{ id: "old", createdAt: new Date("2026-10-07T03:59:59Z"), hasAttachment: true },
    { id: "edge", createdAt: new Date("2026-10-08T04:00:00Z"), hasAttachment: true },
    { id: "text", createdAt: new Date("2026-01-01T00:00:00Z"), hasAttachment: false }];
  expect(selectExpiredBackups(msgs, now, 30)).toEqual(["old"]);
});
test("runBackup posts a readable copy named game-roles-YYYY-MM-DD-HHmm.sqlite and prunes old posts", async () => {
  // file-backed temp DB under os.tmpdir(); write the attachment buffer to a file, open it with better-sqlite3 and count games
});
test("heartbeat pings only while connected; no URL → never", async () => { /* vi.useFakeTimers(); fake fetch */ });
test("heartbeat survives fetch rejecting", async () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/domain/schedule.test.ts tests/services/backup.test.ts tests/services/heartbeat.test.ts`.

`runBackup`:
1. `await db.sqlite.backup(tmpPath)` into `os.tmpdir()`.
2. Send it as `files: [{ attachment: buffer, name }]`.
3. Delete the temp file in `finally`.
4. Prune `selectExpiredBackups(await ownMessages(backupsChannel, 100), now, 30)`.
5. Log a `backup` event.

Errors go to `notifyAdmins`.

`scheduleNightlyBackups` chains `setTimeout(msUntilNextRun(...))`.

- [ ] **Step 3: Commit**

`git commit -m "feat: nightly SQLite backups with 30-day pruning and healthchecks heartbeat"`

---

### Task 15: Custom IDs, command definitions and router

**Files:**
- Create: `src/interactions/custom-ids.ts`, `src/interactions/commands.ts`, `src/interactions/router.ts`
- Test: `tests/interactions/custom-ids.test.ts`, `tests/interactions/router.test.ts`, `tests/interactions/commands.test.ts`

**Interfaces:**
- Produces:
  - `type CustomId`, a discriminated union on `kind`:
    - Member: `panel-open`, `menu` (`action: "add" | "remove" | "suggest" | "mine" | "who" | "mysug" | "lfg"`), `add-select` (`categoryId`, `chunk`), `remove-select` (`chunk`), `pick` (`purpose: "who" | "lfg" | "edit" | "remove"`, `categoryId`, `chunk`), `suggest-modal`, `dup-submit`, `dup-join` (`gameId`), `withdraw` (`suggestionId`), `lfg-modal` (`gameId`, `target: "news" | "here"`), `lfg-in`, `lfg-maybe`, `lfg-join`
    - Admin: `admin` (`action: "review" | "add" | "edit" | "remove" | "categories" | "reapply" | "refresh" | "backup" | "setup"`), `review-approve`, `review-edit`, `review-reject` (each with `suggestionId`), `review-edit-modal`, `review-reject-modal`, `game-add-modal`, `game-edit-modal` (`gameId`), `confirm-remove` (`gameId`), `confirm-setup`, `category-add-modal`, `category-rename-modal` (`categoryId`), `category-move` (`categoryId`, `dir`)
  - `encodeId(id: CustomId): string` with the prefix `gr:` and ≤ 100 characters. `parseId(raw: string): CustomId | null`.
  - `isAdminId(id: CustomId): boolean`
  - `commandDefinitions(): RESTPostAPIApplicationGuildCommandsJSONBody[]`:
    - `/games` with subcommands `menu`, `add game*`, `remove game*`, `suggest`, `mine`, `who game*`, `suggestions`
    - `/lfg game* when? note?`
    - `/gameadmin` with subcommands `setup`, `backup`, `review`, `add name category* aliases?`, `edit game* name? category*? aliases?`, `remove game*`, `reapply-template`, `refresh-panel`, and subcommand group `category` with `add name`, `rename category* name`, `move category* direction(up|down)`
    - User context menus "See their games" and "Games in common"
    - `*` marks an autocomplete option.
  - `registerCommands(rest: REST, config: Config): Promise<void>`. It uses `Routes.applicationGuildCommands`.
  - `route(input: { type: "button" | "select" | "modal" | "command" | "autocomplete" | "user-context"; customId?: string; command?: string; memberRoleIds: ReadonlySet<string> }, adminRoleId: string): { handler: string } | { denied: true } | { unknown: true }`
  - `handleInteraction(ctx: AppContext, handlers: Handlers, interaction: Interaction): Promise<void>`. It calls `route`, replies "Only admins can do that." (ephemeral) when denied, and runs the handler. On `UserFacingError` it replies or follows up with the message, ephemeral. On any other error it sends "Something went wrong. The admins have been told." and calls `notifyAdmins` with the stack.

- [ ] **Step 1: Write the failing tests**

```ts
test("every CustomId round-trips and fits 100 chars", () => {
  for (const id of sampleOfEveryKind) { const raw = encodeId(id); expect(raw.length).toBeLessThanOrEqual(100); expect(parseId(raw)).toEqual(id); }
});
test("foreign or malformed IDs parse to null", () => { expect(parseId("other:1")).toBeNull(); expect(parseId("gr:add-select:x:0")).toBeNull(); });
test("admin IDs and /gameadmin are denied without the admin role, at handling time", () => {
  expect(route({ type: "button", customId: encodeId({ kind: "review-approve", suggestionId: 1 }), memberRoleIds: new Set() }, ADMIN)).toEqual({ denied: true });
  expect(route({ type: "command", command: "gameadmin", memberRoleIds: new Set() }, ADMIN)).toEqual({ denied: true });
  expect(route({ type: "command", command: "gameadmin", memberRoleIds: new Set([ADMIN]) }, ADMIN)).toEqual({ handler: "gameadmin" });
});
test("command definitions: /games menu exists, 2 user context menus, names ≤ 32 chars", () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/interactions`.

The custom ID format is `gr:<kind>:<arg>:<arg>`. Numeric arguments are validated as integers.

The `Handlers` type maps handler names to `(ctx, interaction) => Promise<void>`. Tasks 16–19 fill it in.

- [ ] **Step 3: Commit**

`git commit -m "feat: custom IDs, guild command definitions and admin-guarded router"`

---

### Task 16: Member menu, game picking and lookups

**Files:**
- Create: `src/views/limits.ts`, `src/views/member.ts`, `src/interactions/member.ts`
- Test: `tests/views/member.test.ts`

**Interfaces:**
- Consumes: Tasks 10, 13 and 15
- Produces:
  - Views. Every one returns a V2 payload (`flags: IsComponentsV2`, plus `Ephemeral` when private):
    - `panelView()`: title, one line of explanation, a button "Open game roles"
    - `menuView({ isAdmin: boolean })`: 7 member buttons; the admin row only when `isAdmin`
    - `addGamesView(categories, games, memberRoleIds, page)`: per category, a `###` heading and one multi-select per chunk of 25 with owned options pre-ticked (`min 0`, `max = options`); an empty category shows "_No games yet._"; pages so each page is ≤ 40 components, with Prev/Next buttons
    - `removeGamesView(ownedGames)`
    - `pickGameView(purpose, categories, games)`
    - `myGamesView(games)`, with "Add games" and "Remove games" buttons
    - `gameListView(title, games)`, for "See their games", "Games in common" and "Who plays…?"
  - `countComponents(payload): number`
  - `truncate(text: string, max: number): string`
  - Handlers:
    - `panel-open`, `menu` (`add`, `remove`, `mine`, `who`)
    - `add-select`, `remove-select`, `pick` (`who`)
    - `/games menu | add | remove | mine | who`
    - autocomplete for `game` options
    - both user context menus

- [ ] **Step 1: Write the failing view tests**

```ts
test("menu: 7 member buttons; admin row only for admins", () => {});
test("empty category renders text, never a select with 0 options", () => {
  const p = addGamesView([chill], [], new Set(), 0);
  expect(allSelects(p)).toHaveLength(0);
});
test("category with 30 games → two selects of 25 and 5, owned pre-ticked", () => {});
test("12 categories × 25 games stays ≤ 40 components per page and pages", () => {
  const pages = collectPages(twelveFullCategories);
  for (const p of pages) expect(countComponents(p)).toBeLessThanOrEqual(40);
  expect(pages.flatMap(allSelects)).toHaveLength(12);
});
test("labels and option text are truncated to 100 chars", () => {});
test("panel view has exactly one button with panel-open ID", () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement the views, then run them to verify they pass**

Run `pnpm vitest run tests/views/member.test.ts`.

- [ ] **Step 3: Implement the handlers**

Each handler is a short function. It defers (`deferReply({ flags: Ephemeral })` for new menus, `deferUpdate()` for selects inside a menu), calls one service, and edits the reply with a view.

`add-select` reports in the same message, e.g. "Added Minecraft. Removed Valheim.", plus any missing-role note.

Autocomplete calls `autocompleteGames` with the mode set by the subcommand and responds with `{ name: game.name, value: String(game.id) }`. It doesn't defer. `/games add` and `/games remove` call `join` and `leave` with source `"command"`.

- [ ] **Step 4: Verify**

Run `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: panel menu, add/remove dropdowns, lookups and autocomplete"`

---

### Task 17: Suggestion views and handlers

**Files:**
- Create: `src/views/suggestions.ts`, `src/interactions/suggest.ts`
- Modify: `src/services/suggestions.ts` to use the finished views
- Test: `tests/views/suggestions.test.ts`

**Interfaces:**
- Consumes: Tasks 11, 15 and 16
- Produces:
  - `suggestModal(categories)`: a text input for the name (max 100), a category `StringSelect` inside a `LabelBuilder`, and an optional note text input (max 300)
  - `duplicatePromptView(matches)`: "Did you mean …?" with one "Join {game}" button per game match (≤ 5), plus "Submit anyway" and "Cancel"
  - `mySuggestionsView(suggestions, categoriesById)`: pending first, each with a Withdraw button; at most 10 pending and the 10 most recent decided; rejection reasons shown
  - `reviewCardView(s, categoryName, aliases?)`: Approve, Edit and Reject buttons while pending; a status line and no buttons once decided
  - `reviewEditModal(s, categories)`, `rejectModal(s)`
  - `announcementView(game)`: "New game: {name}" with a role mention that doesn't ping
  - Handlers: `menu` (`suggest`, `mysug`), `/games suggest | suggestions`, `suggest-modal`, `dup-submit`, `dup-join`, `withdraw`, `review-*`
  - `draftStore`: `Map<userId, { draft; expiresAt }>` with a 15-minute time-to-live, swept on each write

- [ ] **Step 1: Write the failing view tests**

```ts
test("review card and announcement never ping", () => {
  expect(reviewCardView(sugg({ name: "@everyone", note: "<@&123>" }), "Chill").allowedMentions).toEqual({ parse: [] });
  expect(announcementView(game).allowedMentions).toEqual({ parse: [] });
});
test("decided card shows who decided and has no buttons", () => {});
test("my suggestions: Withdraw only on pending; rejected shows reason; ≤ 40 components with 10+10", () => {});
test("suggest modal offers every category in the select", () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/views/suggestions.test.ts`.

- [ ] **Step 3: Implement the handlers**

`suggest-modal`: read the fields with `interaction.fields.getTextInputValue` and `getStringSelectValues`, then check `closeMatches`.
- With matches: store the draft and show `duplicatePromptView`.
- Without matches: submit, and confirm with "Suggested {name}. Check its status under My suggestions."

`review-*` buttons: defer the update, call the service, then edit the card. The service already does that, so the handler only acknowledges.

- [ ] **Step 4: Verify, then commit**

Run `pnpm check`. Then `git commit -m "feat: suggestion form, duplicate prompt, review cards"`.

---

### Task 18: LFG views and handlers

**Files:**
- Create: `src/views/lfg.ts`, `src/interactions/lfg.ts`
- Modify: `src/services/lfg.ts` to use the finished view
- Test: `tests/views/lfg.test.ts`

**Interfaces:**
- Consumes: Tasks 12, 15 and 16
- Produces:
  - `lfgPostView(post: LfgPost, game: Game | null)`:
    - shows the author `<@id>`, the game, "When: {as typed}", the note, and the role mention
    - "In (n)" and "Maybe (n)" lists of `<@id>`
    - "I'm in", "Maybe" and "Join this game's role" buttons
    - `allowedMentions: { roles: [game.roleId], parse: [] }` on create
  - `lfgModal(gameId, target)`: optional "when" (max 100) and note (max 300)
  - Handlers:
    - `/lfg`: autocomplete game, then post in the current channel
    - `menu` (`lfg`) → `pick` (`lfg`) → `lfg-modal` (`target: "news"`) → post in `#game-news`
    - `lfg-in`, `lfg-maybe`, `lfg-join`

- [ ] **Step 1: Write the failing view tests**

```ts
test("post pings only its game role; user text can't add mentions", () => {
  const v = lfgPostView(post({ note: "@everyone <@&999>", when: "<@&999> 9pm" }), game);
  expect(v.allowedMentions).toEqual({ roles: [game.roleId], parse: [] });
});
test("'when' is shown exactly as typed (escaped, not interpreted)", () => {});
test("In and Maybe counts and lists", () => {});
test("post for a removed game still renders, labelled removed", () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/views/lfg.test.ts`.

- [ ] **Step 3: Implement the handlers**

`lfg-in` and `lfg-maybe` defer the update, then edit the message with the re-rendered view from `respondToLfg`. `lfg-join` replies ephemerally with "You've joined {game}." or "You already have {game}."

If the bot can't post in the channel where `/lfg` was typed, it replies "I can't post in this channel."

- [ ] **Step 4: Verify, then commit**

Run `pnpm check`. Then `git commit -m "feat: LFG form, post and buttons"`.

---

### Task 19: Admin views and handlers

**Files:**
- Create: `src/views/admin.ts`, `src/interactions/admin.ts`
- Test: `tests/views/admin.test.ts`

**Interfaces:**
- Consumes: Tasks 9, 11, 13, 14, 15 and 16
- Produces:
  - Views:
    - `reviewListView(pending, categoriesById)`: compact cards with the same buttons as `#bot-admin`, capped at 40 components with "and N more in #bot-admin"
    - `gameModal(categories, game?)`: name, category select, aliases
    - `confirmRemoveView(game, memberCount)`: "Remove {game}? {n} members will lose the role." with Confirm and Cancel
    - `categoriesView(categories)`: per category, Up, Down and Rename, plus an Add button
    - `setupPreviewView(problems, plan)`: problems listed first; Confirm disabled while problems exist
    - `setupReportView(result)`
  - Handlers: `admin:*` menu buttons, `/gameadmin *`, `game-add-modal`, `game-edit-modal`, `confirm-remove`, `category-*`, `confirm-setup`. Edit and Remove from the menu go through `pick` first.

- [ ] **Step 1: Write the failing view tests**

```ts
test("setup preview disables Confirm when there are problems", () => {});
test("remove confirmation states the member count", () => {});
test("categories view: no Up on first, no Down on last", () => {});
test("review list caps at 40 components and says how many more", () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/views/admin.test.ts`.

- [ ] **Step 3: Implement the handlers**

`/gameadmin add` requires the `category` option. Its autocomplete offers category names, and its value is the category ID.

`/gameadmin backup` and the "Run backup now" button both call `runBackup` with the actor's ID and reply "Backup posted to #bot-backups."

`/gameadmin setup` shows the preview first, as the spec requires. Nothing is created until Confirm.

Category add, rename and move call the `categories` repo, then log a `category-changed` event (e.g. "renamed Chill → Casual"). A category name that already exists is refused with "There's already a category called {name}."

- [ ] **Step 4: Verify, then commit**

Run `pnpm check`. Then `git commit -m "feat: admin menu, /gameadmin commands, setup preview"`.

---

### Task 20: Startup wiring

**Files:**
- Create: `src/main.ts`, `src/app.ts`
- Test: `tests/app.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `buildHandlers(): Handlers` in `src/app.ts`. It merges the handlers from Tasks 16–19.
  - `onReady(ctx, db, deps: { registerCommands: () => Promise<void> }): Promise<() => void>`, which returns a stop function. On ready it:
    1. registers commands;
    2. fetches all guild members into the cache (`guild.members.fetch()`);
    3. calls `notifyAdmins("Bot started (version {git sha or package version}).")`;
    4. starts the nightly backups and the heartbeat.
  - `main.ts`:
    - `loadConfig(process.env)` and `openDatabase`
    - `new Client({ intents: [Guilds, GuildMembers], allowedMentions: { parse: [] } })`
    - `interactionCreate` → `handleInteraction`
    - ignore interactions from other guilds
    - on SIGTERM/SIGINT: stop timers, `client.destroy()`, `db.close()`
    - `process.on("unhandledRejection")` → `notifyAdmins`

- [ ] **Step 1: Write the failing tests**

```ts
test("every handler name the router can return is implemented", () => {
  const handlers = buildHandlers();
  for (const name of allRouteHandlerNames()) expect(handlers[name], name).toBeTypeOf("function");
});
test("onReady posts the started notice and registers commands once", async () => {});
```

- [ ] **Step 2: Run them to verify they fail, implement, then run them to verify they pass**

Run `pnpm vitest run tests/app.test.ts`.

- [ ] **Step 3: Smoke-run locally (needs the dev bot's `.env`)**

Run `pnpm dev`. Expected:
- the console says it logged in;
- `#bot-admin` gets "Bot started";
- the commands appear in the test server.

Then run `/gameadmin setup`. Expected: a preview, and after Confirm the channels and panel exist.

If no dev bot is set up yet, mark this step blocked and continue. The user runs it.

- [ ] **Step 4: Commit**

`git commit -m "feat: wire client, startup notice, timers and shutdown"`

---

### Task 21: Container, deploy pipeline and docs

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `compose.yaml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml`, `README.md`, `LICENSE`, `docs/manual-test-checklist.md`

**Interfaces:**
- Consumes: the `pnpm check` and `pnpm start` scripts (Task 1)

- [ ] **Step 1: Write the `Dockerfile` and `.dockerignore`**

`Dockerfile`:
- **Build stage** `FROM node:26-slim`:
  - install `python3 make g++`, in case better-sqlite3 has no prebuilt binary
  - `RUN npm install -g pnpm@12.18.0`
  - copy the manifest, lockfile and `pnpm-workspace.yaml`, then `pnpm install --prod --frozen-lockfile`
- **Runtime stage** `FROM node:26-slim`, with no build tools:
  - copy `node_modules` from the build stage, plus `package.json`, `src/` and `drizzle/`
  - `USER node`
  - `CMD ["node", "src/main.ts"]`

`.dockerignore` excludes `.env*`, `data/`, `.git`, `tests/` and `docs/`.

- [ ] **Step 2: Write `compose.yaml`**

```yaml
services:
  bot:
    build: .
    env_file: .env
    environment: { DATABASE_PATH: /app/data/bot.sqlite }
    volumes: ["./data:/app/data"]
    restart: unless-stopped
    mem_limit: 256m
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }
```

No `ports`. Compose gives the project its own network.

- [ ] **Step 3: Verify the image**

Run `docker compose build && docker compose run --rm bot node -e "new (require('better-sqlite3'))(':memory:'); console.log('ok')"`. Expected: `ok`.

- [ ] **Step 4: Write `.github/workflows/deploy.yml`**

- Trigger on `push` to `main` and `workflow_dispatch` only. Top-level `permissions: contents: read`.
- Job `check`: checkout, set up pnpm and Node 26, `pnpm install --frozen-lockfile`, `pnpm check`.
- Job `deploy`: `needs: check`. Write `secrets.DEPLOY_SSH_KEY` to a file and `secrets.DEPLOY_HOST_FINGERPRINT` to `known_hosts`, then run `ssh -i key ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}`. No command is sent: the key's forced command runs the script.
- Pin every action to a full commit SHA. Look each SHA up with `git ls-remote https://github.com/<owner>/<action> refs/tags/<tag>` and put the tag in a trailing comment.

- [ ] **Step 5: Write `.github/dependabot.yml`**

Weekly updates for `npm` and `github-actions`.

- [ ] **Step 6: Write `README.md`**

It needs these sections:
1. "Built for one server" and how to run your own copy.
2. Dev setup: the Developer Portal steps, the invite permissions from `REQUIRED_PERMISSIONS`, `.env`, `pnpm dev`, then `/gameadmin setup`.
3. Droplet setup:
   - deploy user without sudo
   - `authorized_keys` line `command="/usr/local/bin/deploy-game-roles-bot",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 …`
   - the root-owned deploy script's content (`cd /opt/game-roles-bot && git fetch origin main && git reset --hard origin/main && docker compose up -d --build`), noting the live copy lives outside the repo
   - `.env` set to `chmod 600`
   - checking swap and memory
4. GitHub setup checklist, copied from the spec.
5. Restoring a backup.
6. "If something leaks", copied from the spec.

- [ ] **Step 7: Write `LICENSE` and the manual checklist**

`LICENSE` is MIT unless the user chose otherwise. Ask before this step if the user hasn't answered.

`docs/manual-test-checklist.md` mirrors the spec's manual checks: the panel, add and remove, suggest and approve, LFG, the right-click options and the logs, done as both an admin and a non-admin tester. Add one line per Review Focus item.

- [ ] **Step 8: Verify**

Run `pnpm check && docker compose config -q`. Expected: no output from compose, and everything passes.

- [ ] **Step 9: Commit**

`git commit -m "chore: Docker, compose, deploy workflow and README"`
