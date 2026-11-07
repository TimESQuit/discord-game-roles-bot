import { ComponentType, MessageFlags } from "discord.js";
import { expect, test } from "vitest";
import type { Game, LfgPost } from "../db/index.ts";
import { lfgModal, lfgPostView } from "./lfg.ts";
import { countComponents } from "./limits.ts";

const game: Game = {
  id: 7,
  name: "Valheim",
  roleId: "100000000000000500",
  categoryId: 1,
} as unknown as Game;

const base: LfgPost = {
  messageId: "100000000000000950",
  channelId: "100000000000000900",
  gameId: 7,
  gameName: "Valheim",
  authorId: "100000000000000001",
  when: null,
  note: null,
  createdAt: "2026-01-15T12:00:00Z",
  in: [],
  maybe: [],
};
const post = (over: Partial<LfgPost> = {}): LfgPost => ({ ...base, ...over });

/** Every text display's content, in order, plus every button. */
function walk(value: unknown, out: { texts: string[]; buttons: Record<string, unknown>[] }) {
  if (Array.isArray(value)) for (const v of value) walk(v, out);
  else if (value !== null && typeof value === "object") {
    const c = value as { type?: number; content?: string; components?: unknown };
    if (c.type === ComponentType.TextDisplay) out.texts.push(c.content ?? "");
    if (c.type === ComponentType.Button) out.buttons.push(value as Record<string, unknown>);
    walk(c.components, out);
  }
  return out;
}
const parts = (p: { components?: unknown }) => walk(p.components, { texts: [], buttons: [] });
const all = (p: { components?: unknown }) => parts(p).texts.join("\n");

test("is a layout-V2 message with no content or embeds", () => {
  const v = lfgPostView(post(), game);
  expect((v.flags as number) & MessageFlags.IsComponentsV2).toBeTruthy();
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
  for (const t of parts(v).texts) expect(t.length).toBeLessThanOrEqual(4000);
  expect(all(v)).toContain("In (300):");
});

test("has the three buttons with fixed IDs", () => {
  const { buttons } = parts(lfgPostView(post(), game));
  expect(buttons.map((b) => [b.custom_id, b.label])).toEqual([
    ["gr:lfg-in", "I'm in"],
    ["gr:lfg-maybe", "Maybe"],
    ["gr:lfg-join", "Join this game's role"],
  ]);
});

test("post for a removed game still renders, labelled removed", () => {
  const v = lfgPostView(post({ gameId: null }), null);
  const text = all(v);
  expect(text).toContain("(this game has been removed)");
  expect(text).not.toContain("<@&");
  expect(v.allowedMentions).toEqual({ parse: [] });
});

test("lfgModal has optional when (max 100) and note (max 300)", () => {
  const json = lfgModal(7, "news").toJSON();
  expect(json.custom_id).toBe("gr:lfg-modal:7:news");
  expect(JSON.stringify(json)).toContain("tonight 9pm");
  const inputs = (json.components as unknown as { component: Record<string, unknown> }[]).map(
    (l) => l.component,
  );
  expect(inputs.map((i) => [i.required, i.max_length])).toEqual([
    [false, 100],
    [false, 300],
  ]);
  expect(inputs[0]?.style).toBe(1);
  expect(inputs[1]?.style).toBe(2);
  expect(lfgModal(7, "here").toJSON().custom_id).toBe("gr:lfg-modal:7:here");
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
  for (const t of parts(v).texts) expect(t.length).toBeLessThanOrEqual(4000);
  expect(all(v)).toContain(`<@&${game.roleId}>`);
});
