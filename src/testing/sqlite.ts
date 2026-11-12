import { z } from "zod";

import type { Database } from "better-sqlite3";

/** The first column of the first row (undefined when there is none), checked against `schema`. */
export function scalar<T>(
  sqlite: Database,
  query: string,
  schema: z.ZodType<T>,
  ...params: unknown[]
): T {
  return schema.parse(
    sqlite
      .prepare(query)
      .pluck()
      .get(...params),
  );
}

/** The first column of every row, checked against `schema`. */
export function column<T>(sqlite: Database, query: string, schema: z.ZodType<T>): T[] {
  return z.array(schema).parse(sqlite.prepare(query).pluck().all());
}

/** How many rows `table` holds. */
export const countRows = (sqlite: Database, table: string): number =>
  scalar(sqlite, `SELECT COUNT(*) FROM "${table}"`, z.number());
