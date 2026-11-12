import { z } from "zod";

import { CUSTOM_ID_LIMIT, MOVE_DIRECTIONS } from "../constants.ts";

/**
 * Custom IDs are the strings attached to buttons, select menus and modals. Discord sends the
 * string back when a user interacts with the component, so it records what the component is for.
 *
 *   { kind: "pick", purpose: "who", categoryId: 3, chunk: 0 }  ⇄  "gr:pick:who:3:0"
 */
const PREFIX = "gr";

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

export type MenuAction = (typeof MENU_ACTIONS)[number];
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export type PickPurpose = (typeof PURPOSES)[number];

/** A numeric segment of the string: digits only, at most 15 so it stays an exact integer. */
const int = z
  .string()
  .regex(/^\d{1,15}$/)
  .transform(Number);

/** One kind of ID: its name, then its arguments in the order they appear in the string. */
function id<K extends string, Args extends z.ZodRawShape>(kind: K, args: Args) {
  return z.object({ kind: z.literal(kind), ...args });
}

const CustomIdSchema = z.discriminatedUnion("kind", [
  id("panel-open", {}),
  id("menu", { action: z.enum(MENU_ACTIONS) }),
  id("add-select", { categoryId: int, chunk: int }),
  id("add-page", { page: int }),
  id("remove-select", { chunk: int }),
  id("pick", { purpose: z.enum(PURPOSES), categoryId: int, chunk: int }),
  id("pick-page", { purpose: z.enum(PURPOSES), page: int }),
  id("suggest-modal", {}),
  id("dup-submit", {}),
  id("dup-join", { gameId: int }),
  id("withdraw", { suggestionId: int }),
  id("lfg-modal", { gameId: int }),
  id("lfg-in", {}),
  id("lfg-maybe", {}),
  id("lfg-join", {}),
  id("close", {}),
  id("admin", { action: z.enum(ADMIN_ACTIONS) }),
  id("review-approve", { suggestionId: int }),
  id("review-edit", { suggestionId: int }),
  id("review-reject", { suggestionId: int }),
  id("review-edit-modal", { suggestionId: int }),
  id("review-reject-modal", { suggestionId: int }),
  id("game-add-modal", {}),
  id("game-edit-modal", { gameId: int }),
  id("confirm-remove", { gameId: int }),
  id("confirm-setup", {}),
  id("uninstall-options", {}),
  id("uninstall-confirm", { choices: int }),
  id("category-add-modal", {}),
  id("category-rename-modal", { categoryId: int }),
  id("category-move", { categoryId: int, dir: z.enum(MOVE_DIRECTIONS) }),
  id("category-add", {}),
  id("category-rename", { categoryId: int }),
]);

export type CustomId = z.infer<typeof CustomIdSchema>;
export type CustomIdKind = CustomId["kind"];

/** Every kind of ID, in schema order. */
export const CUSTOM_ID_KINDS: readonly CustomIdKind[] = CustomIdSchema.options.map(
  (option) => option.shape.kind.value,
);

/** For each kind, its argument names in string order, e.g. "pick" → ["purpose", "categoryId", "chunk"]. */
const ARG_NAMES: ReadonlyMap<string, readonly string[]> = new Map(
  CustomIdSchema.options.map((option) => [
    option.shape.kind.value,
    Object.keys(option.shape).filter((name) => name !== "kind"),
  ]),
);

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
  "uninstall-options",
  "uninstall-confirm",
  "category-add-modal",
  "category-rename-modal",
  "category-move",
  "category-add",
  "category-rename",
]);

/** "gr:pick:who:3:0" → { kind: "pick", purpose: "who", categoryId: 3, chunk: 0 }, or null if it isn't one of ours. */
export function parseId(raw: string): CustomId | null {
  const [prefix, kind, ...args] = raw.split(":");
  if (prefix !== PREFIX || kind === undefined) return null;

  const argNames = ARG_NAMES.get(kind);
  if (argNames === undefined || args.length !== argNames.length) return null;

  const candidate = { kind, ...Object.fromEntries(argNames.map((name, i) => [name, args[i]])) };
  const result = CustomIdSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** { kind: "pick", purpose: "who", categoryId: 3, chunk: 0 } → "gr:pick:who:3:0" */
export function encodeId(customId: CustomId): string {
  const fields: Record<string, unknown> = customId;
  const values = (ARG_NAMES.get(customId.kind) ?? []).map((name) => String(fields[name]));
  const raw = [PREFIX, customId.kind, ...values].join(":");
  if (raw.length > CUSTOM_ID_LIMIT) {
    throw new RangeError(`Custom ID is longer than ${CUSTOM_ID_LIMIT} characters`);
  }
  return raw;
}

export function isAdminId(customId: CustomId): boolean {
  if (customId.kind === "pick" || customId.kind === "pick-page") {
    return ADMIN_PURPOSES.some((purpose) => purpose === customId.purpose);
  }
  return ADMIN_KINDS.has(customId.kind);
}
