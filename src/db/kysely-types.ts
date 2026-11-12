import type { InferInsertModel, InferSelectModel, Table } from "drizzle-orm";
import type { ColumnType } from "kysely";
import type {
  categories,
  gameAliases,
  games,
  lfgPosts,
  lfgResponses,
  setup,
  suggestions,
} from "./schema.ts";

type InsertValue<T extends Table, K> = K extends keyof InferInsertModel<T>
  ? InferInsertModel<T>[K]
  : never;

/**
 * A Drizzle table as Kysely sees it through `CamelCasePlugin`: the schema's own camelCase keys,
 * so rows come back already shaped like the types in types.ts and need no mapping.
 */
type Camel<T extends Table> = {
  [K in keyof InferSelectModel<T>]: ColumnType<
    InferSelectModel<T>[K],
    InsertValue<T, K>,
    InsertValue<T, K>
  >;
};

export interface DB {
  categories: Camel<typeof categories>;
  games: Camel<typeof games>;
  gameAliases: Camel<typeof gameAliases>;
  setup: Camel<typeof setup>;
  suggestions: Camel<typeof suggestions>;
  lfgPosts: Camel<typeof lfgPosts>;
  lfgResponses: Camel<typeof lfgResponses>;
}
