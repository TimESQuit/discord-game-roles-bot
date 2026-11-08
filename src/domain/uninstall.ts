/** What an admin can choose to keep, plus whether the bot leaves afterwards. Order fixes the bits. */
export const UNINSTALL_OPTIONS = [
  "keepRoles",
  "keepMemberChannels",
  "keepAdminChannels",
  "leave",
] as const;

export type UninstallOption = (typeof UNINSTALL_OPTIONS)[number];
export type UninstallChoices = ReadonlySet<UninstallOption>;

const isOption = (value: string): value is UninstallOption =>
  UNINSTALL_OPTIONS.some((option) => option === value);

/** The choices as one number, so they fit in a button's custom ID. */
export const choicesToBits = (choices: UninstallChoices): number =>
  UNINSTALL_OPTIONS.reduce((bits, option, i) => (choices.has(option) ? bits | (1 << i) : bits), 0);

export const choicesFromBits = (bits: number): UninstallChoices =>
  new Set(UNINSTALL_OPTIONS.filter((_, i) => (bits & (1 << i)) !== 0));

/** The ticked values of the choices menu; anything unknown is ignored. */
export const choicesFromValues = (values: readonly string[]): UninstallChoices =>
  new Set(values.filter(isOption));

export type ChannelGroup = "member" | "admin";

export interface UninstallSummary {
  gameRoles: number;
  /** Members holding at least one game role. */
  members: number;
  memberChannels: number;
  /** Not counting the category. */
  adminChannels: number;
  /** The group of the channel the command was run from, if it is one of the bot's. */
  here: ChannelGroup | null;
}

/** True when uninstalling would delete the channel the admin is looking at. */
export const deletesHere = (here: ChannelGroup | null, choices: UninstallChoices): boolean =>
  (here === "member" && !choices.has("keepMemberChannels")) ||
  (here === "admin" && !choices.has("keepAdminChannels"));

export interface UninstallResult {
  deletedRoles: number;
  deletedChannels: number;
  backup: { name: string; attachment: Buffer };
}
