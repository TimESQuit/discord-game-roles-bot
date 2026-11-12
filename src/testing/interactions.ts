import {
  ApplicationCommandType,
  BaseInteraction,
  ButtonInteraction,
  ComponentType,
  InteractionType,
  MessageFlags,
  MessageFlagsBitField,
  SnowflakeUtil,
} from "discord.js";

import type { MessageResolvable, PermissionsString } from "discord.js";

export const FAKE_USER_ID = "100000000000000001";

/** One call a fake interaction received: the method and its argument (a deleted message's ID for `delete`). */
export type Call = { method: string; arg?: unknown };

/** The fields discord.js's own type checks (isButton() and friends) read. */
const KINDS = {
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
} as const;

export type FakeKind = keyof typeof KINDS;

export type FakeOptions = {
  customId?: string;
  commandName?: string;
  subcommand?: string;
  subcommandGroup?: string;
  roles?: string[];
  channelId?: string;
  /** Already answered (deferred), so replies go out as follow-ups. */
  deferred?: boolean;
  /** Every call except `respond` throws, as when Discord is unreachable. */
  failReplies?: boolean;
  /** When the interaction was created; sets its snowflake ID. */
  createdAt?: number;
  /** The message a component sits on. */
  onMessage?: string;
  /** Whether that message is private. */
  ephemeral?: boolean;
  /** The ID a new reply gets. */
  replyId?: string;
  /** A select menu's chosen values. */
  values?: string[];
  /** The options the select menu was rendered with, as Discord sends them back. */
  rendered?: readonly { value: string; default?: boolean | null }[];
  /** A modal's submitted fields: text inputs as strings, selects as arrays. */
  fields?: Record<string, string | string[]>;
  /** A slash command's string options. */
  strings?: Record<string, string>;
  /** The member's permissions in the channel. */
  permissions?: PermissionsString[];
  /** The interaction comes from a thread under this parent channel. */
  threadParentId?: string;
};

const PRIVATE = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

const fakeMessage = (id: string, flags: number) => ({ id, flags: new MessageFlagsBitField(flags) });

/**
 * Turns `made` (an object on a real interaction prototype, so discord.js's own type checks run)
 * into a fake of `kind` that records every call in `calls` instead of reaching Discord.
 * A deferred update answers on the component's own message; a new reply is its own message.
 */
function fakeOn<T extends BaseInteraction>(made: T, kind: FakeKind, calls: Call[], o: FakeOptions) {
  const { onMessage = "menu-1", replyId = "reply-1", ephemeral = true } = o;
  let original = onMessage;
  const record = (method: string, arg?: unknown): void => {
    calls.push({ method, arg });
    if (o.failReplies === true && method !== "respond") throw new Error("discord down");
  };
  const answered = (key: "deferred" | "replied") => Object.assign(made, { [key]: true });
  // A getter on the prototype that reads the client's cache; the fake has only a thread, if any.
  const thread = o.threadParentId;
  Object.defineProperty(made, "channel", {
    value: thread === undefined ? null : { isThread: () => true, parentId: thread },
  });
  // Also a getter, reading the message the component sits on.
  Object.defineProperty(made, "component", {
    value: o.rendered === undefined ? null : { options: o.rendered },
  });
  const fields = o.fields ?? {};
  const field = (name: string, want: "string" | "array") => {
    const value = fields[name];
    if (want === "string" ? typeof value !== "string" : !Array.isArray(value)) {
      throw new Error(`No ${want} field ${name}`);
    }
    return value;
  };
  return Object.assign(made, {
    ...KINDS[kind],
    id: SnowflakeUtil.generate({ timestamp: o.createdAt ?? Date.now() }).toString(),
    deferred: o.deferred ?? false,
    replied: false,
    customId: o.customId,
    commandName: o.commandName,
    channelId: o.channelId ?? "100000000000009999",
    user: { id: FAKE_USER_ID },
    member: { roles: o.roles ?? [] },
    message: fakeMessage(onMessage, ephemeral ? PRIVATE : MessageFlags.IsComponentsV2),
    options: {
      getSubcommand: () => o.subcommand ?? null,
      getSubcommandGroup: () => o.subcommandGroup ?? null,
      getString: (name: string, required = false) => {
        const value = o.strings?.[name];
        if (value === undefined && required) throw new Error(`No option ${name}`);
        return value ?? null;
      },
    },
    values: o.values ?? [],
    fields: {
      fields: new Map(Object.entries(fields)),
      getTextInputValue: (name: string) => field(name, "string"),
      getStringSelectValues: (name: string) => field(name, "array"),
    },
    memberPermissions:
      o.permissions === undefined
        ? null
        : { has: (p: PermissionsString) => o.permissions?.includes(p) ?? false },
    deferUpdate: async () => {
      record("deferUpdate");
      answered("deferred");
    },
    deferReply: async () => {
      record("deferReply");
      original = replyId;
      answered("deferred");
    },
    editReply: async (arg: unknown) => {
      record("editReply", arg);
      return fakeMessage(original, PRIVATE);
    },
    reply: async (arg: unknown) => {
      record("reply", arg);
      original = replyId;
      answered("replied");
      return { resource: { message: fakeMessage(replyId, PRIVATE) } };
    },
    followUp: async (arg: unknown) => {
      record("followUp", arg);
      return fakeMessage("follow-up-1", PRIVATE);
    },
    respond: async (arg: unknown) => record("respond", arg),
    webhook: {
      deleteMessage: async (message: MessageResolvable) => {
        const id =
          message === "@original" ? original : typeof message === "string" ? message : message.id;
        record("delete", id);
      },
    },
  });
}

/** A fake interaction of any kind, as the router receives it. */
export function fakeInteraction(
  calls: Call[],
  o: FakeOptions & { type: FakeKind },
): BaseInteraction {
  const made: unknown = Object.create(BaseInteraction.prototype);
  if (!(made instanceof BaseInteraction)) throw new Error("Could not build a fake interaction");
  return fakeOn(made, o.type, calls, o);
}

/** A fake button press, for handlers that take a ButtonInteraction. */
export function fakeButton(calls: Call[], o: FakeOptions = {}): ButtonInteraction {
  const made: unknown = Object.create(ButtonInteraction.prototype);
  if (!(made instanceof ButtonInteraction)) throw new Error("Could not build a fake interaction");
  return fakeOn(made, "button", calls, o);
}

/** The methods called, in order. */
export const methods = (calls: readonly Call[]): string[] => calls.map((c) => c.method);

/** The IDs of the messages a fake interaction deleted, in order. */
export const deletedIds = (calls: readonly Call[]): unknown[] =>
  calls.filter((c) => c.method === "delete").map((c) => c.arg);
