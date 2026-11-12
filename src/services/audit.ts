import { text } from "../domain/index.ts";
import { silent } from "../views/index.ts";

import type { Repos } from "../db/index.ts";
import type { Gateway } from "../discord/index.ts";

export type AuditEvent =
  | { kind: "joined" | "left"; userId: string; game: string; source: Source }
  | { kind: "suggested"; userId: string; name: string }
  | {
      kind:
        | "suggestion-approved"
        | "suggestion-rejected"
        | "suggestion-edited"
        | "suggestion-withdrawn";
      userId: string;
      name: string;
      reason?: string;
    }
  | { kind: "game-added" | "game-removed"; userId: string; game: string }
  | { kind: "game-edited"; userId: string; game: string; changes: string }
  | { kind: "category-changed"; userId: string; detail: string }
  | { kind: "template-reapplied"; userId: string; count: number }
  | { kind: "backup"; userId: string | null; file: string }
  | { kind: "setup"; userId: string; detail: string }
  | { kind: "started"; version: string }
  | {
      kind: "interaction-expired";
      userId: string;
      handler: string;
      /** Whether a handler started, so it may have changed things before its reply failed. */
      handlerRan: boolean;
      /** Click to arrival, from Discord's timestamp and the bot's clock, so skew can distort it. */
      clickToReceiveMs: number;
      /** Arrival to the failed reply, measured on the bot's clock alone. */
      receiveToFailMs: number;
    }
  | { kind: "uninstalled"; userId: string; detail: string };

const SOURCE_LABELS = {
  panel: "panel",
  command: "command",
  lfg: "LFG post",
  suggestion: "suggestion",
} as const satisfies Record<string, string>;

export type Source = keyof typeof SOURCE_LABELS;

const user = (id: string): string => `<@${id}>`;

export function formatAuditLine(e: AuditEvent): string {
  switch (e.kind) {
    case "joined":
      return `${user(e.userId)} joined **${text(e.game)}** (${SOURCE_LABELS[e.source]})`;
    case "left":
      return `${user(e.userId)} left **${text(e.game)}** (${SOURCE_LABELS[e.source]})`;
    case "suggested":
      return `${user(e.userId)} suggested **${text(e.name)}**`;
    case "suggestion-approved":
    case "suggestion-rejected":
    case "suggestion-edited":
    case "suggestion-withdrawn": {
      const verb =
        e.kind === "suggestion-withdrawn" ? "withdrew" : e.kind.slice("suggestion-".length);
      const reason = e.reason ? `: ${text(e.reason)}` : "";
      return `${user(e.userId)} ${verb} suggestion **${text(e.name)}**${reason}`;
    }
    case "game-added":
      return `${user(e.userId)} added game **${text(e.game)}**`;
    case "game-removed":
      return `${user(e.userId)} removed game **${text(e.game)}**`;
    case "game-edited":
      return `${user(e.userId)} edited game **${text(e.game)}**: ${text(e.changes)}`;
    case "category-changed":
      return `${user(e.userId)} changed categories: ${text(e.detail)}`;
    case "template-reapplied":
      return `${user(e.userId)} reapplied the role template to ${e.count} game roles`;
    case "backup":
      return e.userId === null
        ? `Automatic backup saved: ${text(e.file)}`
        : `${user(e.userId)} created backup ${text(e.file)}`;
    case "setup":
      return `${user(e.userId)} ran setup: ${text(e.detail)}`;
    case "started":
      return `Bot started (version ${text(e.version)}).`;
    case "interaction-expired": {
      const applied = e.handlerRan
        ? " The handler had started, so its changes may have gone through."
        : "";
      return `${user(e.userId)}'s \`${e.handler}\` interaction expired before the bot replied (failed ${e.receiveToFailMs}ms after arriving; arrived about ${e.clickToReceiveMs}ms after the click, by the bot's clock).${applied}`;
    }
    case "uninstalled":
      return `${user(e.userId)} uninstalled the bot: ${text(e.detail)}`;
    default: {
      const unhandled: never = e;
      throw new Error(`Unhandled audit event: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Marks an error report among the routine lines of #game-roles-log. */
const ERROR_PREFIX = "⚠️ ";

/** Discord rejects messages longer than this. */
const MAX_MESSAGE_LENGTH = 2000;

function fitMessage(content: string): string {
  return content.length <= MAX_MESSAGE_LENGTH
    ? content
    : `${content.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

export interface Audit {
  log(e: AuditEvent): Promise<void>;
  /** Posts a problem the bot caught to #game-roles-log, marked so it stands out. */
  reportError(text: string): Promise<void>;
}

export function createAudit(repos: Repos, gateway: Gateway): Audit {
  async function post(content: string): Promise<void> {
    try {
      const channelId = await repos.setup.get("logChannelId");
      if (channelId === undefined) {
        console.log(content);
        return;
      }
      await gateway.send(
        channelId,
        silent({ content: fitMessage(content), allowedMentions: { parse: [] } }),
      );
    } catch (error) {
      console.error("Could not post to logChannelId:", content, error);
    }
  }
  return {
    log: (e) => post(formatAuditLine(e)),
    reportError: (notice) => post(`${ERROR_PREFIX}${notice}`),
  };
}
