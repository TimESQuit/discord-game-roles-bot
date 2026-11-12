import { SELECT_OPTION_LIMIT } from "../constants.ts";

export function diffSelection(
  shownRoleIds: readonly string[],
  currentRoleIds: ReadonlySet<string>,
  selectedRoleIds: readonly string[],
): { add: string[]; remove: string[] } {
  const selected = new Set(selectedRoleIds);
  const add: string[] = [];
  const remove: string[] = [];
  for (const id of shownRoleIds) {
    const has = currentRoleIds.has(id);
    const wants = selected.has(id);
    if (wants && !has) add.push(id);
    else if (!wants && has) remove.push(id);
  }
  return { add, remove };
}

export function computeRoleOrder(
  roles: readonly { id: string; position: number }[],
  templateId: string,
  gameRoleIdsAlphabetical: readonly string[],
): { id: string; position: number }[] {
  const uniqueGames = [...new Set(gameRoleIdsAlphabetical)];
  const gameIds = new Set(uniqueGames);
  const known = new Set(roles.map((r) => r.id));
  const top = roles.filter((r) => r.position !== 0).toSorted((a, b) => b.position - a.position);
  const rest = top.filter((r) => !gameIds.has(r.id)).map((r) => r.id);
  const templateIndex = rest.indexOf(templateId);
  if (templateIndex === -1) throw new Error("Template role not found in role list.");
  const games = uniqueGames.filter((id) => known.has(id));
  const ordered = [...rest.slice(0, templateIndex + 1), ...games, ...rest.slice(templateIndex + 1)];
  const oldPositions = new Map(roles.map((r) => [r.id, r.position]));
  const changes: { id: string; position: number }[] = [];
  ordered.forEach((id, index) => {
    const position = ordered.length - index;
    if (gameIds.has(id) && oldPositions.get(id) !== position) changes.push({ id, position });
  });
  return changes;
}

/**
 * True when two roles at or below `botTopPosition` share a position. Older servers can
 * end up like this; the bot then can't move roles, because there is no free position
 * below its own. Dragging any role in Server Settings makes Discord renumber them all.
 */
export function hasTiedRolePositions(
  roles: readonly { position: number }[],
  botTopPosition: number,
): boolean {
  const seen = new Set<number>();
  for (const { position } of roles) {
    if (position === 0 || position > botTopPosition) continue;
    if (seen.has(position)) return true;
    seen.add(position);
  }
  return false;
}

export function chunk<T>(items: readonly T[], size: number = SELECT_OPTION_LIMIT): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function isAdmin(memberRoleIds: ReadonlySet<string>, adminRoleId: string): boolean {
  return memberRoleIds.has(adminRoleId);
}
