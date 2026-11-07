import type { Kysely } from "kysely";
import type { DB } from "../kysely-types.ts";
import { createCategories, type CategoriesRepo } from "./categories.ts";
import { createGames, type GamesRepo } from "./games.ts";
import { createLfg, type LfgRepo } from "./lfg.ts";
import { createSetup, type SetupRepo } from "./setup.ts";
import { createSuggestions, type SuggestionsRepo } from "./suggestions.ts";

export type { CategoriesRepo, GamesRepo, LfgRepo, SetupRepo, SuggestionsRepo };

export type Repos = {
  categories: CategoriesRepo;
  games: GamesRepo;
  setup: SetupRepo;
  suggestions: SuggestionsRepo;
  lfg: LfgRepo;
};

export function createRepos(kysely: Kysely<DB>): Repos {
  return {
    categories: createCategories(kysely),
    games: createGames(kysely),
    setup: createSetup(kysely),
    suggestions: createSuggestions(kysely),
    lfg: createLfg(kysely),
  };
}
