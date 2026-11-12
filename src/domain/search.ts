import Fuse from "fuse.js";

import { AUTOCOMPLETE_CHOICE_LIMIT } from "../constants.ts";
import { normalize } from "../normalize.ts";

export interface Searchable {
  name: string;
  aliases: readonly string[];
}

interface Indexed<T> {
  item: T;
  name: string;
  aliases: string[];
}

function search<T extends Searchable>(
  q: string,
  items: readonly T[],
  threshold: number,
  minMatchCharLength: number,
): { item: T; name: string; score: number }[] {
  const records: Indexed<T>[] = items.map((item) => ({
    item,
    name: normalize(item.name),
    aliases: item.aliases.map(normalize),
  }));
  const fuse = new Fuse(records, {
    keys: ["name", "aliases"],
    ignoreLocation: true,
    includeScore: true,
    shouldSort: true,
    minMatchCharLength,
    threshold,
  });
  return fuse
    .search(q)
    .map((r) => ({ item: r.item.item, name: r.item.name, score: r.score ?? 1 }))
    .toSorted((a, b) => a.score - b.score || a.name.localeCompare(b.name, "en"));
}

export function rankGames<T extends Searchable>(
  query: string,
  items: readonly T[],
  limit = AUTOCOMPLETE_CHOICE_LIMIT,
): T[] {
  if (query.trim() === "") return items.slice(0, limit);
  const q = normalize(query);
  if (q === "") return [];
  return search(q, items, 0.35, 1)
    .slice(0, limit)
    .map((r) => r.item);
}

/** Names shorter than this (after normalizing) only count as duplicates on an exact match. */
export const MIN_FUZZY_SUGGESTION_LENGTH = 5;

export function findCloseMatches<T extends Searchable>(name: string, items: readonly T[]): T[] {
  const q = normalize(name);
  if (q === "") return [];
  const squashed = q.replaceAll(" ", "");
  const exact = new Set<T>(
    items.filter((item) =>
      [item.name, ...item.aliases].some((raw) => {
        const n = normalize(raw);
        return n === q || n.replaceAll(" ", "") === squashed;
      }),
    ),
  );
  // Short names only prompt on exact equality: fuzzy matching a 4-letter name like "Rust"
  // or "Rain" against scattered letters in longer names suggests unrelated games.
  const fuzzy =
    q.length >= MIN_FUZZY_SUGGESTION_LENGTH ? search(q, items, 0.3, 2).map((r) => r.item) : [];
  const found = new Set<T>([...exact, ...fuzzy]);
  return items.filter((item) => found.has(item));
}

export function parseAliases(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const n = normalize(part);
    if (n !== "") seen.add(n);
  }
  return [...seen];
}

/** Categories whose name starts with the query, then those that contain it, each in display order. */
export function rankCategories<T extends { name: string; position: number }>(
  query: string,
  categories: readonly T[],
  limit = AUTOCOMPLETE_CHOICE_LIMIT,
): T[] {
  const q = normalize(query);
  const rank = (c: T): number => {
    const n = normalize(c.name);
    return n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2;
  };
  return categories
    .filter((c) => rank(c) < 2)
    .toSorted((a, b) => rank(a) - rank(b) || a.position - b.position)
    .slice(0, limit);
}

/** Alphabetical by normalized name, then ID, so every list shows the same order. */
export function byName(a: { id: number; name: string }, b: { id: number; name: string }): number {
  return normalize(a.name).localeCompare(normalize(b.name), "en") || a.id - b.id;
}
