import {
  ApplicationCommandType,
  BaseInteraction,
  ComponentType,
  InteractionType,
  MessageFlags,
} from "discord.js";
import { afterEach, describe, expect, test, vi } from "vitest";

import { encodeId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { ADMIN_ROLE_ID as ADMIN, makeContext } from "../testing/index.ts";
import { noticeView } from "../views/index.ts";
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

  test("IDs longer than 100 characters are unknown", () => {
    expect(
      route(
        { type: "button", customId: `gr:cancel${"x".repeat(100)}`, memberRoleIds: admins },
        ADMIN,
      ),
    ).toEqual({ unknown: true });
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

type FakeOpts = {
  type: "button" | "select" | "modal" | "command" | "autocomplete" | "user-context" | "other";
  subcommand?: string;
  subcommandGroup?: string;
  log?: string[];
  customId?: string;
  commandName?: string;
  roles?: string[];
  deferred?: boolean;
  failReplies?: boolean;
};

/** The fields discord.js's own type checks (isButton() and friends) read. */
const KINDS: Record<FakeOpts["type"], object> = {
  button: { type: InteractionType.MessageComponent, componentType: ComponentType.Button },
  select: { type: InteractionType.MessageComponent, componentType: ComponentType.StringSelect },
  modal: { type: InteractionType.ModalSubmit },
  command: {
    type: InteractionType.ApplicationCommand,
    commandType: ApplicationCommandType.ChatInput,
  },
  autocomplete: { type: InteractionType.ApplicationCommandAutocomplete },
  "user-context": {
    type: InteractionType.ApplicationCommand,
    commandType: ApplicationCommandType.User,
  },
  other: { type: InteractionType.Ping },
};

/** A real interaction prototype with just the data the router reads, so type checks such as
 * isButton() run discord.js's own code. Replies are recorded instead of sent.
 */
function fake(o: FakeOpts): { i: BaseInteraction; calls: { method: string; arg: unknown }[] } {
  const calls: { method: string; arg: unknown }[] = [];
  const record = (method: string) => async (arg?: unknown) => {
    calls.push({ method, arg });
    o.log?.push(method);
    if (o.failReplies && method !== "respond") throw new Error("discord down");
  };
  const made: unknown = Object.create(BaseInteraction.prototype);
  if (!(made instanceof BaseInteraction)) throw new Error("Could not build a fake interaction");
  const i = Object.assign(made, {
    ...KINDS[o.type],
    deferred: o.deferred ?? false,
    replied: false,
    customId: o.customId,
    commandName: o.commandName,
    member: { roles: o.roles ?? [] },
    options: {
      getSubcommand: () => o.subcommand ?? null,
      getSubcommandGroup: () => o.subcommandGroup ?? null,
    },
    reply: record("reply"),
    followUp: record("followUp"),
    respond: record("respond"),
  });
  return { i, calls };
}

const reply = (content: string) => noticeView(content);

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
    const b = fake({ type: "button", customId: encodeId({ kind: "cancel" }) });
    await handleInteraction(ctx, {}, b.i);
    expect(b.calls[0]?.arg).toEqual(reply("That button has expired. Open the menu again."));
    const c = fake({ type: "autocomplete", commandName: "nothing" });
    await handleInteraction(ctx, {}, c.i);
    expect(c.calls).toEqual([{ method: "respond", arg: [] }]);
  });

  test("UserFacingError replies before defer and follows up after", async () => {
    const ctx = await makeContext();
    const handlers = {
      cancel: async () => {
        throw new UserFacingError("Nope, that is full.");
      },
    };
    const a = fake({ type: "button", customId: encodeId({ kind: "cancel" }) });
    await handleInteraction(ctx, handlers, a.i);
    expect(a.calls).toEqual([{ method: "reply", arg: reply("Nope, that is full.") }]);
    const b = fake({ type: "button", customId: encodeId({ kind: "cancel" }), deferred: true });
    await handleInteraction(ctx, handlers, b.i);
    expect(b.calls).toEqual([{ method: "followUp", arg: reply("Nope, that is full.") }]);
    expect(ctx.adminNotices).toEqual([]);
  });

  test("unexpected error gives a generic reply and an admin notice", async () => {
    const ctx = await makeContext({ setup: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { i, calls } = fake({ type: "button", customId: encodeId({ kind: "cancel" }) });
    await handleInteraction(
      ctx,
      {
        cancel: async () => {
          throw new Error("boom secret detail");
        },
      },
      i,
    );
    expect(calls).toEqual([
      { method: "reply", arg: reply("Something went wrong. The admins have been told.") },
    ]);
    expect(ctx.adminNotices).toHaveLength(1);
    expect(ctx.adminNotices[0]).toContain("cancel");
    expect(ctx.adminNotices[0]).toContain("boom secret detail");
    expect(ctx.adminNotices[0]?.length).toBeLessThanOrEqual(1700);
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
    expect(ctx.adminNotices).toEqual([]);
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

  test("non-admin /gameadmin category rename is denied", async () => {
    const ctx = await makeContext();
    const handler = vi.fn<() => Promise<void>>();
    const { i, calls } = fake({
      type: "command",
      commandName: "gameadmin",
      subcommandGroup: "category",
      subcommand: "rename",
    });
    await handleInteraction(ctx, { "gameadmin-category-rename": handler }, i);
    expect(handler).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: "reply", arg: reply("Only admins can do that.") }]);
  });

  test("a fake command named like an admin handler is unknown, not run", async () => {
    const ctx = await makeContext();
    const handler = vi.fn<() => Promise<void>>();
    const { i, calls } = fake({ type: "command", commandName: "admin", subcommand: "setup" });
    await handleInteraction(ctx, { "admin-setup": handler }, i);
    expect(handler).not.toHaveBeenCalled();
    expect(calls[0]?.arg).toEqual(reply("That button has expired. Open the menu again."));
  });

  test("the generic reply is sent before the admins are notified, and the notice is truncated", async () => {
    const ctx = await makeContext({ setup: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    vi.spyOn(ctx.audit, "notifyAdmins").mockImplementation(async (text) => {
      log.push(`notify:${text.length}`);
    });
    const { i } = fake({ type: "button", customId: encodeId({ kind: "cancel" }), log });
    await handleInteraction(
      ctx,
      {
        cancel: async () => {
          throw new Error("x".repeat(5000));
        },
      },
      i,
    );
    expect(log[0]).toBe("reply");
    expect(log[1]).toBe("notify:1500");
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
      customId: encodeId({ kind: "cancel" }),
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
      customId: encodeId({ kind: "cancel" }),
      failReplies: true,
    });
    await handleInteraction(
      ctx,
      {
        cancel: async () => {
          throw new Error("boom");
        },
      },
      i,
    );
    expect(ctx.adminNotices).toHaveLength(1);
    expect(ctx.adminNotices[0]).toContain("boom");
  });

  test("a failing error reply does not throw", async () => {
    const ctx = await makeContext({ setup: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { i } = fake({
      type: "button",
      customId: encodeId({ kind: "cancel" }),
      failReplies: true,
    });
    await expect(
      handleInteraction(
        ctx,
        {
          cancel: async () => {
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
  const matching: Record<keyof typeof kinds, FakeOpts["type"]> = {
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
