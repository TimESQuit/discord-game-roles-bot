import { ButtonStyle, ComponentType, escapeMarkdown } from "discord.js";
import type { Game, Suggestion } from "../db/types.ts";
import type { Payload } from "../discord/gateway.ts";

/** Escapes Markdown and breaks up "@" so user-typed text can neither format nor ping. */
function text(value: string): string {
  return escapeMarkdown(value).replaceAll("@", "@​");
}

function statusLine(s: Suggestion): string {
  switch (s.status) {
    case "pending":
      return "Pending review";
    case "approved":
      return `Approved by <@${s.reviewerId}>`;
    case "rejected":
      return `Rejected by <@${s.reviewerId}>${s.rejectionReason ? `: ${text(s.rejectionReason)}` : ""}`;
    case "withdrawn":
      return "Withdrawn";
  }
}

/** Minimal review card; Task 17 finishes the layout. */
export function reviewCardView(
  s: Suggestion,
  categoryName: string,
  aliases: string | null = s.aliases,
): Payload {
  const lines = [
    `**Suggestion #${s.id}:** **${text(s.name)}** from <@${s.suggesterId}>`,
    `Category: ${text(categoryName)}`,
  ];
  if (aliases) lines.push(`Aliases: ${text(aliases)}`);
  if (s.note) lines.push(`Note: ${text(s.note)}`);
  lines.push(statusLine(s));
  const payload: Payload = { content: lines.join("\n"), allowedMentions: { parse: [] } };
  if (s.status === "pending") {
    payload.components = [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Success,
            label: "Approve",
            custom_id: `gr:review-approve:${s.id}`,
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            label: "Edit",
            custom_id: `gr:review-edit:${s.id}`,
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Danger,
            label: "Reject",
            custom_id: `gr:review-reject:${s.id}`,
          },
        ],
      },
    ];
  }
  return payload;
}

/** Minimal announcement; Task 17 finishes it. */
export function announcementView(game: Game): Payload {
  return {
    content: `New game: **${text(game.name)}** — <@&${game.roleId}>`,
    allowedMentions: { parse: [] },
  };
}
