export const PANEL_CHANNEL_NAME = "game-roles";
export const NEWS_CHANNEL_NAME = "game-news";
export const ADMIN_CATEGORY_NAME = "Bot admin";
export const ADMIN_CHANNEL_NAME = "bot-admin";
export const LOG_CHANNEL_NAME = "bot-log";
export const BACKUPS_CHANNEL_NAME = "bot-backups";
export const TEMPLATE_ROLE_NAME = "Game role template";
export const STARTING_CATEGORIES = ["Competitive", "Chill", "IRL activities"] as const;
export const MAX_PENDING_SUGGESTIONS = 10;
export const BACKUP_RETENTION_DAYS = 30;
export const HEARTBEAT_INTERVAL_MS = 300_000;
export const SELECT_OPTION_LIMIT = 25;
export const COMPONENT_LIMIT = 40;
export const TEXT_LIMIT = 100;
export const TEXT_DISPLAY_LIMIT = 4000;
export const TEXT_INPUT_LIMIT = 4000;
export const BUTTONS_PER_ROW = 5;
export const AUTOCOMPLETE_CHOICE_LIMIT = 25;
export const CUSTOM_ID_LIMIT = 100;
export const PEOPLE_SHOWN_MAX = 50;

/** Longest text each form field and command option accepts; validation and the field share them. */
export const GAME_NAME_MAX = 100;
export const ALIASES_MAX = 300;
export const NOTE_MAX = 300;
export const REASON_MAX = 300;
export const LFG_WHEN_MAX = 100;
export const CATEGORY_NAME_MAX = 50;
export const MOVE_DIRECTIONS = ["up", "down"] as const;
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/** User-facing replies that more than one module sends. */
export const MESSAGES = {
  gameGone: "That game no longer exists.",
  menuExpired: "That menu has expired. Open it again.",
  setupFirst: "Run /gameadmin setup first.",
  categoryGone: "That category doesn't exist.",
  pickGame: "Pick a game from the list.",
  suggestionGone: "That suggestion no longer exists.",
  formExpired: "That form has expired. Open it again.",
  pickCategory: "Pick a category from the list.",
  nothingChanged: "Nothing changed.",
  noGamesPicked: "You haven't picked any games yet.",
  gameRoleMissing: "That game's role is missing; the admins have been told.",
  botRoleTooLow: `Move the bot's role above ${TEMPLATE_ROLE_NAME} in Server Settings → Roles.`,
  rolePositionsTied:
    "Some roles share a position, so the bot can't sort game roles. In Server Settings → Roles, drag any role down one place and back up, then try again.",
} as const;
