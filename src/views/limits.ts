/** Cuts to at most `max` characters (code points), ending in "…" when it cut. */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}
