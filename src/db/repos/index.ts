import { createCategories } from "./categories.ts";
import { createGames } from "./games.ts";
import { createLfg } from "./lfg.ts";
import { createSetup } from "./setup.ts";
import { createSuggestions } from "./suggestions.ts";

import type { Kysely } from "kysely";
import type { DB } from "../kysely-types.ts";
import type { CategoriesRepo } from "./categories.ts";
import type { GamesRepo } from "./games.ts";
import type { LfgRepo } from "./lfg.ts";
import type { SetupRepo } from "./setup.ts";
import type { SuggestionsRepo } from "./suggestions.ts";

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
