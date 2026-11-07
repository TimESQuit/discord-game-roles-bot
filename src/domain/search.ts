export interface Searchable {
  name: string;
  aliases: readonly string[];
}

type Tier = 0 | 1 | 2 | 3 | 4;

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

/** Optimal string alignment distance: an adjacent swap counts as 1. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

function typoThreshold(queryLength: number): number {
  return queryLength <= 5 ? 1 : 2;
}

function acronym(name: string): string {
  return name
    .split(" ")
    .filter((w) => w !== "")
    .map((w) => (/^[0-9]+$/.test(w) ? w : w[0]!))
    .join("");
}

function smallestDistance(query: string, name: string): number {
  const candidates = [name, ...name.split(" "), name.slice(0, query.length)];
  return Math.min(...candidates.map((c) => editDistance(query, c)));
}

function tierForName(query: string, name: string): Tier | null {
  if (name.startsWith(query)) return 0;
  if (name.split(" ").some((w) => w.startsWith(query))) return 1;
  if (name.includes(query)) return 2;
  if (query.length >= 3 && smallestDistance(query, name) <= typoThreshold(query.length)) return 3;
  if (acronym(name) === query) return 4;
  return null;
}

export function matchTier(query: string, item: Searchable): Tier | null {
  const q = normalize(query);
  if (q === "") return null;
  let best: Tier | null = null;
  for (const raw of [item.name, ...item.aliases]) {
    const tier = tierForName(q, normalize(raw));
    if (tier !== null && (best === null || tier < best)) best = tier;
  }
  return best;
}

export function rankGames<T extends Searchable>(
  query: string,
  items: readonly T[],
  limit = 25,
): T[] {
  if (query.trim() === "") return items.slice(0, limit);
  const scored: { item: T; tier: Tier }[] = [];
  for (const item of items) {
    const tier = matchTier(query, item);
    if (tier !== null) scored.push({ item, tier });
  }
  scored.sort(
    (a, b) => a.tier - b.tier || normalize(a.item.name).localeCompare(normalize(b.item.name), "en"),
  );
  return scored.slice(0, limit).map((s) => s.item);
}

export function findCloseMatches<T extends Searchable>(name: string, items: readonly T[]): T[] {
  const q = normalize(name);
  if (q === "") return [];
  const squashed = q.replaceAll(" ", "");
  return items.filter((item) =>
    [item.name, ...item.aliases].some((raw) => {
      const n = normalize(raw);
      return (
        n === q ||
        n.replaceAll(" ", "") === squashed ||
        editDistance(q, n) <= typoThreshold(q.length) ||
        acronym(n) === q
      );
    }),
  );
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
