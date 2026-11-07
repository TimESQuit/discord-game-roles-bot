import { expect, test } from "vitest";
import type { LfgPost } from "../../src/db/types.ts";
import { lfgPostView } from "../../src/views/lfg.ts";

const post: LfgPost = {
  messageId: "100000000000000950",
  channelId: "100000000000000900",
  gameId: null,
  gameName: "Valheim",
  authorId: "100000000000000001",
  when: null,
  note: null,
  createdAt: "2026-01-15T12:00:00Z",
  in: [],
  maybe: [],
};

test("a removed game shows a notice and no role mention", () => {
  const content = String(lfgPostView(post, null).content);
  expect(content).toContain("(this game has been removed)");
  expect(content).not.toContain("<@&");
});
