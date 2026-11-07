import Fuse from "fuse.js";

export interface Searchable {
  name: string;
  aliases: readonly string[];
}

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "en"));
}

export function rankGames<T extends Searchable>(
  query: string,
  items: readonly T[],
  limit = 25,
): T[] {
  if (query.trim() === "") return items.slice(0, limit);
  const q = normalize(query);
  if (q === "") return [];
  return search(q, items, 0.35, 1)
    .slice(0, limit)
    .map((r) => r.item);
}

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
  // Too-short queries only count on exact equality, or "go" would suggest nearly every game.
  const fuzzy = q.length >= 3 ? search(q, items, 0.3, 2).map((r) => r.item) : [];
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

/** Alphabetical by normalized name, then ID, so every list shows the same order. */
export function byName(a: { id: number; name: string }, b: { id: number; name: string }): number {
  return normalize(a.name).localeCompare(normalize(b.name), "en") || a.id - b.id;
}
