import { escapeMarkdown } from "discord.js";
import type { Repos } from "../db/repos/index.ts";
import type { Gateway } from "../discord/gateway.ts";

export type Source = "panel" | "command" | "lfg" | "suggestion";

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
  | { kind: "setup"; userId: string; detail: string };

const SOURCE_LABELS: Record<Source, string> = {
  panel: "panel",
  command: "command",
  lfg: "LFG post",
  suggestion: "suggestion",
};

/** Escapes Markdown and breaks up "@" so user-typed text can neither format nor ping. */
function text(value: string): string {
  return escapeMarkdown(value).replaceAll("@", "@​");
}

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
  }
}

export interface Audit {
  log(e: AuditEvent): Promise<void>;
  notifyAdmins(text: string): Promise<void>;
}

export function createAudit(repos: Repos, gateway: Gateway): Audit {
  async function post(key: "logChannelId" | "adminChannelId", content: string): Promise<void> {
    try {
      const channelId = await repos.setup.get(key);
      if (channelId === undefined) {
        console.log(content);
        return;
      }
      await gateway.send(channelId, { content, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error(`Could not post to ${key}`, error);
    }
  }
  return {
    log: (e) => post("logChannelId", formatAuditLine(e)),
    notifyAdmins: (notice) => post("adminChannelId", notice),
  };
}
