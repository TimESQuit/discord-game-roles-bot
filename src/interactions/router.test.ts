import { ApplicationCommandOptionType, DiscordAPIError, MessageFlags } from "discord.js";
import { afterEach, describe, expect, test, vi } from "vitest";

import { encodeId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import {
  ADMIN_ROLE_ID as ADMIN,
  FAKE_USER_ID,
  fakeInteraction,
  makeContext,
  methods,
} from "../testing/index.ts";
import { messageView } from "../views/index.ts";
import { commandDefinitions } from "./commands.ts";
import { forReply } from "./replies.ts";
import {
  autocomplete,
  button,
  chatInput,
  handleInteraction,
  modal,
  route,
  select,
  userContext,
} from "./router.ts";

import type { BaseInteraction } from "discord.js";
import type { Call, FakeKind } from "../testing/index.ts";

type RouteInputType = Parameters<typeof route>[0]["type"];
const none = new Set<string>();
const admins = new Set([ADMIN]);

const routeMember = (customId: string, type: "button" | "select" | "modal" = "button") =>
  route({ type, customId, memberRoleIds: none }, ADMIN);

const routeCommand = (
  type: "command" | "autocomplete" | "user-context",
  command: string,
  subcommand?: string,
  subcommandGroup?: string,
) => route({ type, command, subcommand, subcommandGroup, memberRoleIds: admins }, ADMIN);

describe("route", () => {
  test("admin IDs and /gameadmin are denied without the admin role", () => {
    const approve = encodeId({ kind: "review-approve", suggestionId: 1 });
    expect(route({ type: "button", customId: approve, memberRoleIds: none }, ADMIN)).toEqual({
      denied: true,
    });
    expect(route({ type: "button", customId: approve, memberRoleIds: admins }, ADMIN)).toEqual({
      handler: "review-approve",
    });
    expect(route({ type: "command", command: "gameadmin", memberRoleIds: none }, ADMIN)).toEqual({
      denied: true,
    });
    expect(
      route({ type: "autocomplete", command: "gameadmin", memberRoleIds: none }, ADMIN),
    ).toEqual({ denied: true });
    expect(
      route(
        { type: "command", command: "gameadmin", subcommand: "setup", memberRoleIds: admins },
        ADMIN,
      ),
    ).toEqual({ handler: "gameadmin-setup" });
  });

  test("member IDs and compound handler names", () => {
    expect(routeMember(encodeId({ kind: "menu", action: "mysug" }))).toEqual({
      handler: "menu-mysug",
    });
    expect(routeMember(encodeId({ kind: "panel-open" }))).toEqual({ handler: "panel-open" });
    expect(
      routeMember(encodeId({ kind: "pick", purpose: "who", categoryId: 1, chunk: 0 }), "select"),
    ).toEqual({ handler: "pick-who" });
    expect(
      routeMember(encodeId({ kind: "pick", purpose: "edit", categoryId: 1, chunk: 0 }), "select"),
    ).toEqual({ denied: true });
    expect(routeMember(encodeId({ kind: "pick-page", purpose: "who", page: 1 }))).toEqual({
      handler: "pick-page-who",
    });
    expect(routeMember(encodeId({ kind: "pick-page", purpose: "lfg", page: 1 }))).toEqual({
      handler: "pick-page-lfg",
    });
    for (const purpose of ["edit", "remove"] as const) {
      const customId = encodeId({ kind: "pick-page", purpose, page: 1 });
      expect(routeMember(customId)).toEqual({ denied: true });
      expect(route({ type: "button", customId, memberRoleIds: admins }, ADMIN)).toEqual({
        handler: `pick-page-${purpose}`,
      });
    }
    expect(routeMember(encodeId({ kind: "admin", action: "reapply" }))).toEqual({ denied: true });
    expect(
      route(
        {
          type: "button",
          customId: encodeId({ kind: "admin", action: "reapply" }),
          memberRoleIds: admins,
        },
        ADMIN,
      ),
    ).toEqual({ handler: "admin-reapply" });
  });

  test("commands, autocomplete and context menus", () => {
    expect(routeCommand("command", "games", "menu")).toEqual({ handler: "games-menu" });
    expect(routeCommand("command", "games", "suggestions")).toEqual({
      handler: "games-suggestions",
    });
    expect(routeCommand("command", "lfg")).toEqual({ handler: "lfg" });
    expect(routeCommand("command", "gameadmin", "reapply-template")).toEqual({
      handler: "gameadmin-reapply-template",
    });
    expect(routeCommand("command", "gameadmin", "move", "category")).toEqual({
      handler: "gameadmin-category-move",
    });
    expect(routeCommand("autocomplete", "games", "add")).toEqual({ handler: "autocomplete-games" });
    expect(routeCommand("autocomplete", "lfg")).toEqual({ handler: "autocomplete-lfg" });
    expect(routeCommand("autocomplete", "gameadmin", "edit")).toEqual({
      handler: "autocomplete-gameadmin",
    });
    expect(routeCommand("user-context", "See their games")).toEqual({ handler: "ctx-see-games" });
    expect(routeCommand("user-context", "Games in common")).toEqual({ handler: "ctx-in-common" });
  });

  test("command names cannot spell admin or custom-ID handlers", () => {
    const roles = none;
    const cases: [RouteInputType, string, string][] = [
      ["command", "admin", "setup"],
      ["command", "review", "approve"],
      ["command", "pick", "edit"],
      ["command", "confirm", "setup"],
      ["command", "menu", "add"],
      ["autocomplete", "pick", "edit"],
      ["autocomplete", "other", "x"],
    ];
    for (const [type, command, subcommand] of cases) {
      expect(route({ type, command, subcommand, memberRoleIds: roles }, ADMIN)).toEqual({
        unknown: true,
      });
      expect(route({ type, command, subcommand, memberRoleIds: admins }, ADMIN)).toEqual({
        unknown: true,
      });
    }
    expect(
      route(
        { type: "command", command: "games", subcommand: "setup", memberRoleIds: admins },
        ADMIN,
      ),
    ).toEqual({ unknown: true });
    expect(
      route(
        { type: "command", command: "gameadmin", subcommand: "bogus", memberRoleIds: admins },
        ADMIN,
      ),
    ).toEqual({ unknown: true });
    expect(
      route(
        {
          type: "command",
          command: "gameadmin",
          subcommandGroup: "category",
          subcommand: "rename",
          memberRoleIds: none,
        },
        ADMIN,
      ),
    ).toEqual({ denied: true });
    expect(
      route({ type: "autocomplete", command: "gameadmin", memberRoleIds: none }, ADMIN),
    ).toEqual({ denied: true });
  });

  test("every registered command, subcommand and context menu routes to a handler", () => {
    const routed: unknown[] = [];
    const routeAs = (command: string, subcommand?: string, subcommandGroup?: string) => {
      const type = subcommand === undefined && command.includes(" ") ? "user-context" : "command";
      routed.push(routeCommand(type, command, subcommand, subcommandGroup));
    };
    for (const definition of commandDefinitions()) {
      const options = "options" in definition ? (definition.options ?? []) : [];
      const subs = options.filter((o) => o.type === ApplicationCommandOptionType.Subcommand);
      const groups = options.filter((o) => o.type === ApplicationCommandOptionType.SubcommandGroup);
      if (subs.length === 0 && groups.length === 0) routeAs(definition.name);
      for (const s of subs) routeAs(definition.name, s.name);
      for (const g of groups) {
        for (const s of "options" in g ? (g.options ?? []) : [])
          routeAs(definition.name, s.name, g.name);
      }
    }
    expect(routed.length).toBeGreaterThan(20);
    for (const result of routed) expect(result).toHaveProperty("handler");
  });

  test("unknown things", () => {
    expect(route({ type: "button", customId: "gr:nope", memberRoleIds: admins }, ADMIN)).toEqual({
      unknown: true,
    });
    expect(route({ type: "button", memberRoleIds: admins }, ADMIN)).toEqual({ unknown: true });
    expect(route({ type: "command", command: "other", memberRoleIds: admins }, ADMIN)).toEqual({
      unknown: true,
    });
    expect(
      route({ type: "command", command: "games", subcommand: "zzz", memberRoleIds: admins }, ADMIN),
    ).toEqual({ unknown: true });
    expect(route({ type: "user-context", command: "x", memberRoleIds: admins }, ADMIN)).toEqual({
      unknown: true,
    });
  });
});

/** A fake interaction of `o.type` and the calls it received. */
function fake(o: Parameters<typeof fakeInteraction>[1]): { i: BaseInteraction; calls: Call[] } {
  const calls: Call[] = [];
  return { i: fakeInteraction(calls, o), calls };
}

const USER = FAKE_USER_ID;

const reply = (content: string) => forReply(messageView(content));

const expiredError = () =>
  new DiscordAPIError({ code: 10062, message: "Unknown interaction" }, 10062, 404, "POST", "/", {});

describe("handleInteraction", () => {
  afterEach(() => vi.restoreAllMocks());

  test("denied button gets a private refusal and the handler does not run", async () => {
    const ctx = await makeContext();
    const handler = vi.fn<() => Promise<void>>();
    const { i, calls } = fake({
      type: "button",
      customId: encodeId({ kind: "admin", action: "backup" }),
    });
    await handleInteraction(ctx, { "admin-backup": handler }, i);
    expect(handler).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: "reply", arg: reply("Only admins can do that.") }]);
  });

  test("denied autocomplete responds with no choices", async () => {
    const ctx = await makeContext();
    const { i, calls } = fake({ type: "autocomplete", commandName: "gameadmin" });
    await handleInteraction(ctx, {}, i);
    expect(calls).toEqual([{ method: "respond", arg: [] }]);
  });

  test("admin role from a raw member roles array runs the handler", async () => {
    const ctx = await makeContext();
    const handler = vi.fn<() => Promise<void>>(async () => {});
    const { i } = fake({
      type: "button",
      customId: encodeId({ kind: "admin", action: "backup" }),
      roles: [ADMIN],
    });
    await handleInteraction(ctx, { "admin-backup": handler }, i);
    expect(handler).toHaveBeenCalledWith(ctx, i);
  });

  test("admin role from a cached GuildMember role manager", async () => {
    const ctx = await makeContext();
    const handler = vi.fn<() => Promise<void>>(async () => {});
    const { i } = fake({
      type: "button",
      customId: encodeId({ kind: "admin", action: "backup" }),
    });
    Object.assign(i, { member: { roles: { cache: new Map([[ADMIN, {}]]) } } });
    await handleInteraction(ctx, { "admin-backup": handler }, i);
    expect(handler).toHaveBeenCalled();
  });

  test("unknown and missing-handler interactions get the expired message", async () => {
    const ctx = await makeContext();
    const a = fake({ type: "button", customId: "gr:nope" });
    await handleInteraction(ctx, {}, a.i);
    expect(a.calls).toEqual([
      { method: "reply", arg: reply("That button has expired. Open the menu again.") },
    ]);
    const b = fake({ type: "button", customId: encodeId({ kind: "close" }) });
    await handleInteraction(ctx, {}, b.i);
    expect(b.calls[0]?.arg).toEqual(reply("That button has expired. Open the menu again."));
    const c = fake({ type: "autocomplete", commandName: "nothing" });
    await handleInteraction(ctx, {}, c.i);
    expect(c.calls).toEqual([{ method: "respond", arg: [] }]);
  });

  test("UserFacingError replies before defer and follows up after", async () => {
    const ctx = await makeContext();
    const handlers = {
      close: async () => {
        throw new UserFacingError("Nope, that is full.");
      },
    };
    const a = fake({ type: "button", customId: encodeId({ kind: "close" }) });
    await handleInteraction(ctx, handlers, a.i);
    expect(a.calls).toEqual([{ method: "reply", arg: reply("Nope, that is full.") }]);
    const b = fake({ type: "button", customId: encodeId({ kind: "close" }), deferred: true });
    await handleInteraction(ctx, handlers, b.i);
    expect(b.calls).toEqual([{ method: "followUp", arg: reply("Nope, that is full.") }]);
    expect(ctx.errorReports).toEqual([]);
  });

  test("unexpected error gives a generic reply and an admin notice", async () => {
    const ctx = await makeContext({ setup: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { i, calls } = fake({ type: "button", customId: encodeId({ kind: "close" }) });
    await handleInteraction(
      ctx,
      {
        close: async () => {
          throw new Error("boom secret detail");
        },
      },
      i,
    );
    expect(methods(calls)).toEqual(["reply"]);
    expect(JSON.stringify(calls[0]?.arg)).not.toContain("boom secret detail");
    expect(ctx.errorReports).toHaveLength(1);
    expect(ctx.errorReports[0]).toContain("close");
    expect(ctx.errorReports[0]).toContain("boom secret detail");
    expect(ctx.errorReports[0]).not.toContain("router.test.ts");
  });

  test("autocomplete errors respond with no choices and notify no one", async () => {
    const ctx = await makeContext({ setup: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { i, calls } = fake({ type: "autocomplete", commandName: "games" });
    await handleInteraction(
      ctx,
      {
        "autocomplete-games": async () => {
          throw new Error("db");
        },
      },
      i,
    );
    expect(calls).toEqual([{ method: "respond", arg: [] }]);
    expect(ctx.errorReports).toEqual([]);
  });

  test("select and modal paths reach their handlers", async () => {
    const ctx = await makeContext();
    const sel = vi.fn<() => Promise<void>>(async () => {});
    const mod = vi.fn<() => Promise<void>>(async () => {});
    const a = fake({
      type: "select",
      customId: encodeId({ kind: "add-select", categoryId: 1, chunk: 0 }),
    });
    await handleInteraction(ctx, { "add-select": sel }, a.i);
    const b = fake({ type: "modal", customId: encodeId({ kind: "suggest-modal" }) });
    await handleInteraction(ctx, { "suggest-modal": mod }, b.i);
    expect(sel).toHaveBeenCalledTimes(1);
    expect(mod).toHaveBeenCalledTimes(1);
  });

  test("the generic reply is sent before the error is reported", async () => {
    const ctx = await makeContext({ setup: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { i, calls } = fake({ type: "button", customId: encodeId({ kind: "close" }) });
    vi.spyOn(ctx.audit, "reportError").mockImplementation(async () => {
      calls.push({ method: "report" });
    });
    await handleInteraction(
      ctx,
      {
        close: async () => {
          throw new Error("boom");
        },
      },
      i,
    );
    expect(methods(calls)).toEqual(["reply", "report"]);
  });

  test("an expired interaction is logged with its timing, not reported as an error", async () => {
    const ctx = await makeContext({ setup: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(ctx.audit, "log");
    const { i, calls } = fake({
      type: "button",
      customId: encodeId({ kind: "close" }),
      createdAt: Date.now() - 5000,
    });
    const expired = expiredError();
    await handleInteraction(
      ctx,
      {
        close: async () => {
          throw expired;
        },
      },
      i,
    );
    expect(ctx.errorReports).toEqual([]);
    expect(calls).toEqual([]);
    expect(err).toHaveBeenCalledWith(expect.any(String), expired);
    const event = log.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      kind: "interaction-expired",
      userId: USER,
      handler: "close",
      handlerRan: true,
    });
    if (event?.kind !== "interaction-expired") throw new Error("Expected an expiry event");
    expect(event.clickToReceiveMs).toBeGreaterThanOrEqual(5000);
    expect(event.receiveToFailMs).toBeGreaterThanOrEqual(0);
  });

  test("an expiry in the router's own reply is logged too", async () => {
    const ctx = await makeContext({ setup: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(ctx.audit, "log");
    const { i } = fake({ type: "button", customId: encodeId({ kind: "close" }) });
    Object.assign(i, {
      reply: async () => {
        throw expiredError();
      },
    });
    await handleInteraction(
      ctx,
      {
        close: async () => {
          throw new UserFacingError("Too slow.");
        },
      },
      i,
    );
    await handleInteraction(ctx, {}, i);
    expect(log.mock.calls.map(([e]) => e)).toEqual([
      expect.objectContaining({ kind: "interaction-expired", handler: "close", handlerRan: true }),
      expect.objectContaining({
        kind: "interaction-expired",
        handler: "close",
        handlerRan: false,
      }),
    ]);
    expect(ctx.errorReports).toEqual([]);
  });

  test("an unhandled interaction kind is warned about", async () => {
    const ctx = await makeContext();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { i, calls } = fake({ type: "other" });
    await handleInteraction(ctx, {}, i);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  test("replies are layout V2 notices with no plain content", async () => {
    const ctx = await makeContext();
    const { i, calls } = fake({
      type: "button",
      customId: encodeId({ kind: "close" }),
      deferred: true,
    });
    await handleInteraction(ctx, {}, i);
    const arg = calls[0]?.arg;
    expect(arg).not.toHaveProperty("content");
    expect(arg).toMatchObject({ flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] });
  });

  test("a throwing reply in the generic-error branch still notifies the admins", async () => {
    const ctx = await makeContext({ setup: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { i } = fake({
      type: "button",
      customId: encodeId({ kind: "close" }),
      failReplies: true,
    });
    await handleInteraction(
      ctx,
      {
        close: async () => {
          throw new Error("boom");
        },
      },
      i,
    );
    expect(ctx.errorReports).toHaveLength(1);
    expect(ctx.errorReports[0]).toContain("boom");
  });

  test("a failing error reply does not throw", async () => {
    const ctx = await makeContext({ setup: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { i } = fake({
      type: "button",
      customId: encodeId({ kind: "close" }),
      failReplies: true,
    });
    await expect(
      handleInteraction(
        ctx,
        {
          close: async () => {
            throw new UserFacingError("x");
          },
        },
        i,
      ),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });
});

describe("handler kind guards", () => {
  const kinds = { button, select, modal, chatInput, autocomplete, userContext };
  const matching: Record<keyof typeof kinds, FakeKind> = {
    button: "button",
    select: "select",
    modal: "modal",
    chatInput: "command",
    autocomplete: "autocomplete",
    userContext: "user-context",
  };

  test("a handler runs for its own kind of interaction", async () => {
    const ctx = await makeContext();
    for (const kind of [
      "button",
      "select",
      "modal",
      "chatInput",
      "autocomplete",
      "userContext",
    ] as const) {
      const fn = vi.fn<() => Promise<void>>(async () => {});
      const { i } = fake({ type: matching[kind] });
      await kinds[kind](fn)(ctx, i);
      expect(fn).toHaveBeenCalledWith(ctx, i);
    }
  });

  test("a handler given another kind of interaction throws and does not run", async () => {
    const ctx = await makeContext();
    for (const [name, wrap] of Object.entries(kinds)) {
      const fn = vi.fn<() => Promise<void>>(async () => {});
      const { i } = fake({ type: name === "button" ? "modal" : "button" });
      await expect(wrap(fn)(ctx, i)).rejects.toThrow("Expected a");
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
