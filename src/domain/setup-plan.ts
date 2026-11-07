import type { SetupKey } from "../db/index.ts";

/** Items in dependency order, each with the setup key that records it. */
export const SETUP_ORDER = [
  { item: "templateRole", key: "templateRoleId" },
  { item: "panelChannel", key: "panelChannelId" },
  { item: "newsChannel", key: "newsChannelId" },
  { item: "adminCategory", key: "adminCategoryId" },
  { item: "adminChannel", key: "adminChannelId" },
  { item: "logChannel", key: "logChannelId" },
  { item: "backupsChannel", key: "backupsChannelId" },
  { item: "categories", key: null },
  { item: "panelMessage", key: "panelMessageId" },
] as const satisfies readonly { item: string; key: SetupKey | null }[];

export type SetupItem = (typeof SETUP_ORDER)[number]["item"];

export function planSetup(state: {
  recorded: Partial<Record<SetupKey, string>>;
  exists: (key: SetupKey) => boolean;
  categoryCount: number;
  panelMessageExists: boolean;
}): { create: SetupItem[]; fine: SetupItem[] } {
  const create: SetupItem[] = [];
  const fine: SetupItem[] = [];
  for (const { item, key } of SETUP_ORDER) {
    let ok: boolean;
    if (item === "categories") ok = state.categoryCount > 0;
    else if (item === "panelMessage") {
      ok =
        state.recorded.panelMessageId !== undefined &&
        state.panelMessageExists &&
        !create.includes("panelChannel");
    } else ok = key !== null && state.recorded[key] !== undefined && state.exists(key);
    (ok ? fine : create).push(item);
  }
  return { create, fine };
}
