import { ComponentType } from "discord.js";
import { beforeEach, describe, expect, test } from "vitest";

import { MESSAGES } from "../constants.ts";
import { encodeId, parseId } from "../domain/index.ts";
import { addGame } from "../services/index.ts";
import {
  A1,
  FAKE_USER_ID,
  defined,
  deletedIds,
  fakeButton,
  fakeInteraction,
  findComponents,
  makeContext,
} from "../testing/index.ts";
import { addGamesView } from "../views/index.ts";
import { memberHandlers } from "./member.ts";
import { openMenus } from "./menus.ts";

import type { Category, Game } from "../db/index.ts";
import type { Call, ComponentSource, TestContext } from "../testing/index.ts";
import type { Handler } from "./router.ts";

const handler = (name: keyof typeof memberHandlers): Handler => {
  const found = memberHandlers[name];
  if (found === undefined) throw new Error(`No handler ${name}`);
  return found;
};

beforeEach(() => openMenus.entries.clear());

test("opening the menu again closes the one already open", async () => {
  const ctx = await makeContext();
  const first: Call[] = [];
  const second: Call[] = [];
  await handler("panel-open")(ctx, fakeButton(first, { replyId: "menu-a" }));
  await handler("panel-open")(ctx, fakeButton(second, { replyId: "menu-b" }));
  expect(deletedIds(first)).toEqual(["menu-a"]);
  expect(deletedIds(second)).toEqual([]);
});

test("Close deletes the message it sits on, and a later menu does not try again", async () => {
  const ctx = await makeContext();
  const opened: Call[] = [];
  await handler("panel-open")(ctx, fakeButton(opened, { replyId: "menu-a" }));
  const closed: Call[] = [];
  const close = fakeButton(closed, { customId: encodeId({ kind: "close" }), onMessage: "menu-a" });
  await handler("close")(ctx, close);
  await handler("panel-open")(ctx, fakeButton([], { replyId: "menu-b" }));
  expect(deletedIds(closed)).toEqual(["menu-a"]);
  expect(deletedIds(opened)).toEqual([]);
});

describe("add-select", () => {
  let ctx: TestContext;
  let chill: Category;
  let alpha: Game;
  let bravo: Game;
  let charlie: Game;

  beforeEach(async () => {
    ctx = await makeContext();
    chill = defined((await ctx.repos.categories.list()).find((c) => c.name === "Chill"));
    const add = (name: string) =>
      addGame(ctx, { name, categoryId: chill.id, aliases: "", actorId: A1 });
    [alpha, bravo, charlie] = [await add("Alpha"), await add("Bravo"), await add("Charlie")];
    ctx.gateway.addMember(FAKE_USER_ID, [alpha.roleId]);
  });

  /** The Chill dropdown of the add menu as the member sees it now. */
  async function renderedDropdown() {
    const view = addGamesView(
      await ctx.repos.categories.list(),
      await ctx.repos.games.list(),
      ctx.gateway.memberRoleIds(FAKE_USER_ID),
      0,
    );
    return chillDropdown(view);
  }

  const chillDropdown = (source: ComponentSource) =>
    defined(
      findComponents(source, ComponentType.StringSelect).find((s) => {
        const id = parseId(s.custom_id);
        return id?.kind === "add-select" && id.categoryId === chill.id;
      }),
    );

  /** Submits `values` on a dropdown rendered earlier; returns the redrawn menu's calls. */
  async function submit(dropdown: Awaited<ReturnType<typeof renderedDropdown>>, values: Game[]) {
    const calls: Call[] = [];
    await handler("add-select")(
      ctx,
      fakeInteraction(calls, {
        type: "select",
        customId: dropdown.custom_id,
        rendered: dropdown.options,
        values: values.map((g) => String(g.id)),
      }),
    );
    return calls;
  }

  const has = (game: Game) => ctx.gateway.memberRoleIds(FAKE_USER_ID).has(game.roleId);

  test("an old menu changes only what was ticked or unticked in it", async () => {
    const stale = await renderedDropdown();
    // Joined elsewhere after the menu was drawn, so it shows Charlie unticked.
    await ctx.gateway.addMemberRole(FAKE_USER_ID, charlie.roleId, "test");

    await submit(stale, [alpha, bravo]);
    expect([has(alpha), has(bravo), has(charlie)]).toEqual([true, true, true]);

    await submit(stale, []);
    expect([has(alpha), has(bravo), has(charlie)]).toEqual([false, true, true]);
  });

  test("the redrawn menu ticks the member's games as they now stand", async () => {
    const calls = await submit(await renderedDropdown(), [bravo]);
    const edit = calls.findLast((c) => c.method === "editReply");
    if (typeof edit?.arg !== "object" || edit.arg === null) throw new Error("No redrawn menu");
    const ticked = chillDropdown(edit.arg).options.filter((o) => o.default === true);
    expect(ticked.map((o) => o.value)).toEqual([String(bravo.id)]);
  });

  test("a menu without its rendered options is refused as expired, changing nothing", async () => {
    const dropdown = await renderedDropdown();
    await expect(
      handler("add-select")(
        ctx,
        fakeInteraction([], { type: "select", customId: dropdown.custom_id, values: [] }),
      ),
    ).rejects.toThrow(MESSAGES.menuExpired);
    expect(has(alpha)).toBe(true);
  });
});
