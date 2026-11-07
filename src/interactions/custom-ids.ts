const PREFIX = "gr:";

export type MenuAction = "add" | "remove" | "suggest" | "mine" | "who" | "mysug" | "lfg";
export type AdminAction =
  | "review"
  | "add"
  | "edit"
  | "remove"
  | "categories"
  | "reapply"
  | "refresh"
  | "backup"
  | "setup";
export type PickPurpose = "who" | "lfg" | "edit" | "remove";

export type CustomId =
  | { kind: "panel-open" }
  | { kind: "menu"; action: MenuAction }
  | { kind: "add-select"; categoryId: number; chunk: number }
  | { kind: "add-page"; page: number }
  | { kind: "remove-select"; chunk: number }
  | { kind: "pick"; purpose: PickPurpose; categoryId: number; chunk: number }
  | { kind: "suggest-modal" }
  | { kind: "dup-submit" }
  | { kind: "dup-join"; gameId: number }
  | { kind: "withdraw"; suggestionId: number }
  | { kind: "lfg-modal"; gameId: number; target: "news" | "here" }
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
  | { kind: "category-move"; categoryId: number; dir: "up" | "down" }
  | { kind: "category-add" }
  | { kind: "category-rename"; categoryId: number };

export type CustomIdKind = CustomId["kind"];

/** An argument is a non-negative integer (`null`) or one of a fixed set of words. */
type ArgSpec = { name: string; words: readonly string[] | null };
const int = (name: string): ArgSpec => ({ name, words: null });
const word = (name: string, words: readonly string[]): ArgSpec => ({ name, words });

const MENU_ACTIONS = ["add", "remove", "suggest", "mine", "who", "mysug", "lfg"] as const;
const ADMIN_ACTIONS = [
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
const PURPOSES = ["who", "lfg", "edit", "remove"] as const;

const SPECS: Record<CustomIdKind, readonly ArgSpec[]> = {
  "panel-open": [],
  menu: [word("action", MENU_ACTIONS)],
  "add-select": [int("categoryId"), int("chunk")],
  "add-page": [int("page")],
  "remove-select": [int("chunk")],
  pick: [word("purpose", PURPOSES), int("categoryId"), int("chunk")],
  "suggest-modal": [],
  "dup-submit": [],
  "dup-join": [int("gameId")],
  withdraw: [int("suggestionId")],
  "lfg-modal": [int("gameId"), word("target", ["news", "here"])],
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
  "category-move": [int("categoryId"), word("dir", ["up", "down"])],
  "category-add": [],
  "category-rename": [int("categoryId")],
};

const ADMIN_KINDS: ReadonlySet<CustomIdKind> = new Set<CustomIdKind>([
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

export function encodeId(id: CustomId): string {
  const fields = id as unknown as Record<string, string | number>;
  const parts = SPECS[id.kind].map((spec) => String(fields[spec.name]));
  const raw = [PREFIX + id.kind, ...parts].join(":");
  if (raw.length > 100) throw new RangeError("Custom ID is longer than 100 characters");
  return raw;
}

export function parseId(raw: string): CustomId | null {
  if (!raw.startsWith(PREFIX)) return null;
  const [kind, ...args] = raw.slice(PREFIX.length).split(":");
  if (kind === undefined || !isKind(kind)) return null;
  const specs = SPECS[kind];
  if (args.length !== specs.length) return null;
  const out: Record<string, string | number> = { kind };
  for (const [index, spec] of specs.entries()) {
    const arg = args[index] as string;
    if (spec.words === null) {
      if (!/^\d{1,15}$/.test(arg)) return null;
      out[spec.name] = Number(arg);
    } else {
      if (!spec.words.includes(arg)) return null;
      out[spec.name] = arg;
    }
  }
  return out as unknown as CustomId;
}

export function isAdminId(id: CustomId): boolean {
  if (id.kind === "pick") return id.purpose === "edit" || id.purpose === "remove";
  return ADMIN_KINDS.has(id.kind);
}
