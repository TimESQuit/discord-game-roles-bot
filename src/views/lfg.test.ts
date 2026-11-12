import { ComponentType, MessageFlags, TextInputStyle } from "discord.js";
import { describe, expect, test } from "vitest";

import {
  A1 as ADMIN,
  U2,
  U3,
  buttonKinds,
  customIdButtons,
  findComponents,
  flagBits,
  parsedIds,
  textOf,
} from "../testing/index.ts";
import { lfgClosedView, lfgManageView, lfgModal, lfgPostView } from "./lfg.ts";
import { countComponents } from "./limits.ts";

import type { Game, LfgPost } from "../db/index.ts";

const game: Game = {
  id: 7,
  name: "Valheim",
  roleId: "100000000000000500",
  categoryId: 1,
  aliases: [],
  addedBy: "100000000000000011",
  addedAt: "2026-01-01T00:00:00Z",
};

const base: LfgPost = {
  messageId: "100000000000000950",
  channelId: "100000000000000900",
  gameId: 7,
  gameName: "Valheim",
  authorId: "100000000000000001",
  when: null,
  note: null,
  createdAt: "2026-01-15T12:00:00Z",
  status: "open",
  closedBy: null,
  closedAt: null,
  in: [],
  maybe: [],
};
const post = (over: Partial<LfgPost> = {}): LfgPost => ({ ...base, ...over });

const all = textOf;
const textParts = (p: Parameters<typeof textOf>[0]) => findComponents(p, ComponentType.TextDisplay);

test("is a layout-V2 message with no content or embeds", () => {
  const v = lfgPostView(post(), game);
  expect(flagBits(v) & MessageFlags.IsComponentsV2).toBeTruthy();
  expect(flagBits(v) & MessageFlags.SuppressNotifications).toBe(0);
  expect(v).not.toHaveProperty("content");
  expect(v).not.toHaveProperty("embeds");
  expect(countComponents(v)).toBeLessThanOrEqual(40);
});

test("post pings only its game role; user text can't add mentions", () => {
  const v = lfgPostView(post({ note: "@everyone <@&999>", when: "<@&999> 9pm" }), game);
  expect(v.allowedMentions).toEqual({ roles: [game.roleId], parse: [] });
  const text = all(v);
  expect(text).toContain(`<@&${game.roleId}>`);
  expect(text).not.toContain("@everyone");
  expect(text).not.toMatch(/<@&999>/);
});

test("'when' is shown exactly as typed (escaped, not interpreted)", () => {
  const text = all(lfgPostView(post({ when: "**tonight** _9pm_" }), game));
  expect(text).toContain("When: \\*\\*tonight\\*\\* \\_9pm\\_");
});

test("shows author, game, note, and omits When when not given", () => {
  const text = all(lfgPostView(post({ note: "bring food" }), game));
  expect(text).toContain("<@100000000000000001> is looking for a group: **Valheim**");
  expect(text).toContain("bring food");
  expect(text).not.toContain("When:");
});

test("In and Maybe counts and lists", () => {
  const text = all(
    lfgPostView(
      post({ in: ["100000000000000002", "100000000000000003"], maybe: ["100000000000000004"] }),
      game,
    ),
  );
  expect(text).toContain("In (2): <@100000000000000002>, <@100000000000000003>");
  expect(text).toContain("Maybe (1): <@100000000000000004>");
  expect(all(lfgPostView(post(), game))).toContain("In (0):");
});

test("a very long In list stays under the text display limit", () => {
  const many = Array.from({ length: 300 }, (_, i) => String(100000000000001000n + BigInt(i)));
  const v = lfgPostView(post({ in: many }), game);
  for (const t of textParts(v)) expect(t.content.length).toBeLessThanOrEqual(4000);
  expect(all(v)).toContain("In (300):");
});

test("has the answer, role and Manage buttons, which fit one row", () => {
  const v = lfgPostView(post(), game);
  expect(buttonKinds(v)).toEqual(["lfg-in", "lfg-maybe", "lfg-role", "lfg-manage"]);
  expect(findComponents(v, ComponentType.ActionRow)).toHaveLength(1);
});

test("post for a removed game still renders, labelled removed", () => {
  const v = lfgPostView(post({ gameId: null }), null);
  const text = all(v);
  expect(text).toContain("(this game has been removed)");
  expect(text).not.toContain("<@&");
  expect(v.allowedMentions).toEqual({ parse: [] });
});

test("lfgModal has optional when (max 100) and note (max 300)", () => {
  const json = lfgModal(7).toJSON();
  expect(JSON.stringify(json)).toContain("tonight 9pm");
  const inputs = findComponents(json.components, ComponentType.TextInput);
  expect(inputs.map((i) => [i.required, i.max_length])).toEqual([
    [false, 100],
    [false, 300],
  ]);
  expect(inputs[0]?.style).toBe(TextInputStyle.Short);
  expect(inputs[1]?.style).toBe(TextInputStyle.Paragraph);
});

test("300 responders show exactly 50 mentions, an overflow line and the full count", () => {
  const many = Array.from({ length: 300 }, (_, i) => String(100000000000001000n + BigInt(i)));
  const text = all(lfgPostView(post({ in: many }), game));
  expect(text).toContain("In (300):");
  expect(text.match(/<@\d+>/g)?.length).toBe(50 + 1); // 50 responders + the author
  expect(text).toContain("…and 250 more");
});

test("worst-case when and note of escapable characters stay under 4000 per text display", () => {
  const v = lfgPostView(post({ when: "*".repeat(100), note: "*".repeat(300) }), game);
  for (const t of textParts(v)) expect(t.content.length).toBeLessThanOrEqual(4000);
  expect(all(v)).toContain(`<@&${game.roleId}>`);
});

describe("lfgClosedView", () => {
  const closed = post({ in: [base.authorId, U2], maybe: [U3] });

  test.each(["finished", "cancelled"] as const)(
    "a %s post is public, has no buttons and pings nobody",
    (outcome) => {
      const v = lfgClosedView(closed, outcome, ADMIN);
      expect(flagBits(v) & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(flagBits(v) & MessageFlags.Ephemeral).toBe(0);
      expect(customIdButtons(v)).toEqual([]);
      expect(v.allowedMentions).toEqual({ parse: [] });
      expect(all(v)).toContain(`<@${ADMIN}>`);
      expect(all(v)).toContain("Valheim");
      expect(all(v)).not.toContain("<@&");
    },
  );

  test("a finished post keeps who went, and only them", () => {
    const text = all(lfgClosedView(closed, "finished", ADMIN));
    expect(text).toContain(`<@${base.authorId}>, <@${U2}>`);
    expect(text).not.toContain(`<@${U3}>`);
  });

  test("a cancelled post lists nobody", () => {
    const text = all(lfgClosedView(closed, "cancelled", ADMIN));
    expect(text).not.toContain(`<@${base.authorId}>`);
    expect(text).not.toContain(`<@${U2}>`);
  });

  test("the game name can't add formatting", () => {
    const text = all(lfgClosedView(post({ gameName: "**Bold**" }), "cancelled", ADMIN));
    expect(text).toContain("\\*\\*Bold\\*\\*");
  });
});

test("the Manage menu is private and its Finish and Cancel buttons name the post", () => {
  const v = lfgManageView(post());
  expect(flagBits(v) & MessageFlags.Ephemeral).toBeTruthy();
  expect(buttonKinds(v)).toEqual(["lfg-finish", "lfg-cancel", "close"]);
  expect(parsedIds(v).slice(0, 2)).toEqual([
    { kind: "lfg-finish", messageId: base.messageId },
    { kind: "lfg-cancel", messageId: base.messageId },
  ]);
});
