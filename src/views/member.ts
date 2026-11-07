import { ButtonStyle, ComponentType } from "discord.js";
import type { Payload } from "../discord/gateway.ts";

/** Minimal panel; Task 16 finishes it. */
export function panelView(): Payload {
  return {
    content: "Pick the games you play. Click the button to open your private game menu.",
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Primary,
            label: "Open game roles",
            custom_id: "gr:panel-open",
          },
        ],
      },
    ],
    allowedMentions: { parse: [] },
  };
}
