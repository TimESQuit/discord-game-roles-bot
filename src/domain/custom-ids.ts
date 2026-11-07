import { CUSTOM_ID_LIMIT, MOVE_DIRECTIONS, type MoveDirection } from "../constants.ts";

const PREFIX = "gr:";

export const MENU_ACTIONS = ["add", "remove", "suggest", "mine", "who", "mysug", "lfg"] as const;
export const ADMIN_ACTIONS = [
  "review",
  "add",
  "edit",
  "remove",
  "categories",
  "reapply",
  "refresh",
  "backup",
  "setup",
] as const;
/** Purposes whose pickers are for admins only. */
export const ADMIN_PURPOSES = ["edit", "remove"] as const;
export const PURPOSES = ["who", "lfg", ...ADMIN_PURPOSES] as const;
export const LFG_TARGETS = ["news", "here"] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export type PickPurpose = (typeof PURPOSES)[number];
export type LfgTarget = (typeof LFG_TARGETS)[number];

export type CustomId =
  | { kind: "panel-open" }
  | { kind: "menu"; action: MenuAction }
  | { kind: "add-select"; categoryId: number; chunk: number }
  | { kind: "add-page"; page: number }
  | { kind: "remove-select"; chunk: number }
  | { kind: "pick"; purpose: PickPurpose; categoryId: number; chunk: number }
  | { kind: "pick-page"; purpose: PickPurpose; page: number }
  | { kind: "suggest-modal" }
  | { kind: "dup-submit" }
  | { kind: "dup-join"; gameId: number }
  | { kind: "withdraw"; suggestionId: number }
  | { kind: "lfg-modal"; gameId: number; target: LfgTarget }
  | { kind: "lfg-in" }
  | { kind: "lfg-maybe" }
  | { kind: "lfg-join" }
  | { kind: "cancel" }
  | { kind: "admin"; action: AdminAction }
  | { kind: "review-approve"; suggestionId: number }
  | { kind: "review-edit"; suggestionId: number }
  | { kind: "review-reject"; suggestionId: number }
  | { kind: "review-edit-modal"; suggestionId: number }
  | { kind: "review-reject-modal"; suggestionId: number }
  | { kind: "game-add-modal" }
  | { kind: "game-edit-modal"; gameId: number }
  | { kind: "confirm-remove"; gameId: number }
  | { kind: "confirm-setup" }
  | { kind: "category-add-modal" }
  | { kind: "category-rename-modal"; categoryId: number }
  | { kind: "category-move"; categoryId: number; dir: MoveDirection }
  | { kind: "category-add" }
  | { kind: "category-rename"; categoryId: number };

export type CustomIdKind = CustomId["kind"];

/** The fields of one kind of ID, without its `kind`. */
type ArgKeys<K extends CustomIdKind> = Exclude<keyof Extract<CustomId, { kind: K }>, "kind">;
/** A number field is a non-negative integer (`null`); a field of string literals lists them. */
type Words<V> = [V] extends [number] ? null : readonly V[];
/** One argument of kind K: a real field of that ID, with words matching its type. */
type SpecFor<K extends CustomIdKind> = {
  [N in ArgKeys<K>]: { name: N; words: Words<Extract<CustomId, { kind: K }>[N]> };
}[ArgKeys<K>];
/** What the codec needs of any argument, whatever its kind. */
type ArgSpec = { name: string; words: readonly string[] | null };
const int = <N extends string>(name: N) => ({ name, words: null });
const word = <N extends string, W extends string>(name: N, words: readonly W[]) => ({
  name,
  words,
});

const SPECS: { [K in CustomIdKind]: readonly SpecFor<K>[] } = {
  "panel-open": [],
  menu: [word("action", MENU_ACTIONS)],
  "add-select": [int("categoryId"), int("chunk")],
  "add-page": [int("page")],
  "remove-select": [int("chunk")],
  pick: [word("purpose", PURPOSES), int("categoryId"), int("chunk")],
  "pick-page": [word("purpose", PURPOSES), int("page")],
  "suggest-modal": [],
  "dup-submit": [],
  "dup-join": [int("gameId")],
  withdraw: [int("suggestionId")],
  "lfg-modal": [int("gameId"), word("target", LFG_TARGETS)],
  "lfg-in": [],
  "lfg-maybe": [],
  "lfg-join": [],
  cancel: [],
  admin: [word("action", ADMIN_ACTIONS)],
  "review-approve": [int("suggestionId")],
  "review-edit": [int("suggestionId")],
  "review-reject": [int("suggestionId")],
  "review-edit-modal": [int("suggestionId")],
  "review-reject-modal": [int("suggestionId")],
  "game-add-modal": [],
  "game-edit-modal": [int("gameId")],
  "confirm-remove": [int("gameId")],
  "confirm-setup": [],
  "category-add-modal": [],
  "category-rename-modal": [int("categoryId")],
  "category-move": [int("categoryId"), word("dir", MOVE_DIRECTIONS)],
  "category-add": [],
  "category-rename": [int("categoryId")],
};

export const ADMIN_KINDS: ReadonlySet<CustomIdKind> = new Set<CustomIdKind>([
  "admin",
  "review-approve",
  "review-edit",
  "review-reject",
  "review-edit-modal",
  "review-reject-modal",
  "game-add-modal",
  "game-edit-modal",
  "confirm-remove",
  "confirm-setup",
  "category-add-modal",
  "category-rename-modal",
  "category-move",
  "category-add",
  "category-rename",
]);

function isKind(value: string): value is CustomIdKind {
  return Object.hasOwn(SPECS, value);
}

/** Checks a parsed record against the spec of its kind: the same rules parseId applies. */
function isCustomId(value: unknown): value is CustomId {
  if (typeof value !== "object" || value === null) return false;
  const kind: unknown = Reflect.get(value, "kind");
  if (typeof kind !== "string" || !isKind(kind)) return false;
  const specs: readonly ArgSpec[] = SPECS[kind];
  return specs.every((spec) => {
    const arg: unknown = Reflect.get(value, spec.name);
    if (spec.words === null) return typeof arg === "number" && Number.isInteger(arg) && arg >= 0;
    return typeof arg === "string" && spec.words.includes(arg);
  });
}

export function encodeId(id: CustomId): string {
  const fields: Record<string, unknown> = id;
  const specs: readonly ArgSpec[] = SPECS[id.kind];
  const parts = specs.map((spec) => String(fields[spec.name]));
  const raw = [PREFIX + id.kind, ...parts].join(":");
  if (raw.length > CUSTOM_ID_LIMIT) {
    throw new RangeError(`Custom ID is longer than ${CUSTOM_ID_LIMIT} characters`);
  }
  return raw;
}

export function parseId(raw: string): CustomId | null {
  if (!raw.startsWith(PREFIX)) return null;
  const [kind, ...args] = raw.slice(PREFIX.length).split(":");
  if (kind === undefined || !isKind(kind)) return null;
  const specs: readonly ArgSpec[] = SPECS[kind];
  if (args.length !== specs.length) return null;
  const out: Record<string, string | number> = { kind };
  for (const [index, spec] of specs.entries()) {
    const arg = args[index];
    if (arg === undefined) return null;
    if (spec.words === null) {
      if (!/^\d{1,15}$/.test(arg)) return null;
      out[spec.name] = Number(arg);
    } else {
      if (!spec.words.includes(arg)) return null;
      out[spec.name] = arg;
    }
  }
  return isCustomId(out) ? out : null;
}

export function isAdminId(id: CustomId): boolean {
  if (id.kind === "pick" || id.kind === "pick-page") {
    return ADMIN_PURPOSES.some((purpose) => purpose === id.purpose);
  }
  return ADMIN_KINDS.has(id.kind);
}
