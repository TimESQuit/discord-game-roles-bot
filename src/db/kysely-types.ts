import type { Kyselify } from "drizzle-orm/kysely";
import type {
  categories,
  gameAliases,
  games,
  lfgPosts,
  lfgResponses,
  setup,
  suggestions,
} from "./schema.ts";

export interface DB {
  categories: Kyselify<typeof categories>;
  games: Kyselify<typeof games>;
  game_aliases: Kyselify<typeof gameAliases>;
  setup: Kyselify<typeof setup>;
  suggestions: Kyselify<typeof suggestions>;
  lfg_posts: Kyselify<typeof lfgPosts>;
  lfg_responses: Kyselify<typeof lfgResponses>;
}
