import { SELECT_OPTION_LIMIT, TEXT_LIMIT } from "../constants.ts";
import { UserFacingError } from "../errors.ts";
import { normalize } from "./search.ts";

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
  const gameIds = new Set(gameRoleIdsAlphabetical);
  const known = new Set(roles.map((r) => r.id));
  const top = roles.filter((r) => r.position !== 0).toSorted((a, b) => b.position - a.position);
  const rest = top.filter((r) => !gameIds.has(r.id)).map((r) => r.id);
  const templateIndex = rest.indexOf(templateId);
  if (templateIndex === -1) throw new Error("Template role not found in role list.");
  const games = gameRoleIdsAlphabetical.filter((id) => known.has(id));
  const ordered = [...rest.slice(0, templateIndex + 1), ...games, ...rest.slice(templateIndex + 1)];
  const oldPositions = new Map(roles.map((r) => [r.id, r.position]));
  const changes: { id: string; position: number }[] = [];
  ordered.forEach((id, index) => {
    const position = ordered.length - index;
    if (oldPositions.get(id) !== position) changes.push({ id, position });
  });
  return changes;
}

export function chunk<T>(items: readonly T[], size: number = SELECT_OPTION_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function isAdmin(memberRoleIds: ReadonlySet<string>, adminRoleId: string): boolean {
  return memberRoleIds.has(adminRoleId);
}

export function validateGameName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (normalize(name) === "") {
    throw new UserFacingError("Game names need at least one letter or number.");
  }
  if (name.length > TEXT_LIMIT) {
    throw new UserFacingError(`Game names can be at most ${TEXT_LIMIT} characters.`);
  }
  return name;
}
