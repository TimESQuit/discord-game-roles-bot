import { ButtonStyle, ComponentType } from "discord.js";

import { ADMIN_CATEGORY_NAME, NEWS_CHANNEL_NAME, PANEL_CHANNEL_NAME } from "../constants.ts";
import { UNINSTALL_OPTIONS, choicesToBits, deletesHere, encodeId } from "../domain/index.ts";
import { button, buttonRow, closeButton, display, payload } from "./components.ts";

import type { APIActionRowComponent, APIStringSelectComponent } from "discord.js";
import type { Payload } from "../discord/index.ts";
import type {
  UninstallChoices,
  UninstallOption,
  UninstallResult,
  UninstallSummary,
} from "../domain/index.ts";

const count = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

const OPTION_TEXT = {
  keepRoles: { label: "Keep roles", description: "Members keep their game roles" },
  keepMemberChannels: {
    label: "Keep member channels",
    description: `#${PANEL_CHANNEL_NAME} and #${NEWS_CHANNEL_NAME} stay, with their messages`,
  },
  keepAdminChannels: {
    label: "Keep admin channels",
    description: "The admin category, the log and the backups stay",
  },
  leave: { label: "Leave the server afterwards", description: "Otherwise the bot stays" },
} as const satisfies Record<UninstallOption, { label: string; description: string }>;

function choicesMenu(choices: UninstallChoices): APIActionRowComponent<APIStringSelectComponent> {
  const options = UNINSTALL_OPTIONS.map((option) => ({
    value: option,
    ...OPTION_TEXT[option],
    ...(choices.has(option) ? { default: true } : {}),
  }));
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        custom_id: encodeId({ kind: "uninstall-options" }),
        placeholder: "Choose what to keep",
        min_values: 0,
        max_values: options.length,
        options,
      },
    ],
  };
}

export function uninstallPreviewView(
  summary: UninstallSummary,
  choices: UninstallChoices,
): Payload {
  const roles = `${count(summary.gameRoles, "game role")} (held by ${count(summary.members, "member")}) and the template role`;
  const memberChannels = count(summary.memberChannels, "member channel");
  const adminChannels = `the ${ADMIN_CATEGORY_NAME} category and ${count(summary.adminChannels, "channel")}`;

  const owns = [
    "### Uninstall",
    "**The bot owns**",
    `- ${roles}`,
    `- ${memberChannels}`,
    `- ${adminChannels}`,
  ];
  const plan = [
    "**This will**",
    choices.has("keepRoles") ? "- Keep all roles" : `- Delete ${roles}`,
    choices.has("keepMemberChannels")
      ? "- Keep the member channels, removing the panel message"
      : `- Delete ${memberChannels}`,
    choices.has("keepAdminChannels") ? "- Keep the admin channels" : `- Delete ${adminChannels}`,
    "- Wipe the bot's data. A backup is attached to the report.",
    choices.has("leave")
      ? "- Leave the server"
      : "- Stay in the server, ready for /gameadmin setup",
  ];
  const blocked = deletesHere(summary.here, choices);
  if (blocked) {
    plan.push(
      "**Run this from a channel you're keeping, so the report and backup can reach you.**",
    );
  }

  return payload(
    [
      display(owns.join("\n")),
      choicesMenu(choices),
      display(plan.join("\n")),
      buttonRow(
        button(
          { kind: "uninstall-confirm", choices: choicesToBits(choices) },
          "Uninstall",
          ButtonStyle.Danger,
          blocked,
        ),
        closeButton("Cancel"),
      ),
    ],
    true,
  );
}

export function uninstallReportView(result: UninstallResult, choices: UninstallChoices): Payload {
  const lines = [
    "### Uninstall finished",
    `Deleted ${count(result.deletedRoles, "role")} and ${count(result.deletedChannels, "channel")}. The bot's data is wiped; the attached file is a backup of it.`,
  ];
  if (
    choices.has("keepRoles") ||
    choices.has("keepMemberChannels") ||
    choices.has("keepAdminChannels")
  ) {
    lines.push("Anything kept is now an ordinary role or channel the bot no longer manages.");
  }
  lines.push(
    choices.has("leave")
      ? "The bot is leaving the server now. Stop its container too."
      : "Run /gameadmin setup to start again.",
  );
  return {
    ...payload([display(lines.join("\n"))], true),
    files: [{ attachment: result.backup.attachment, name: result.backup.name }],
  };
}
