import { LFG_WHEN_MAX, MESSAGES, NEWS_CHANNEL_NAME, NOTE_MAX } from "../constants.ts";
import { toggleResponse } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { lfgPostView } from "../views/index.ts";
import { requireGame } from "./lookups.ts";
import { assertRoleExists, join } from "./membership.ts";

import type { LfgAnswer, LfgPost } from "../db/index.ts";
import type { AppContext } from "./context.ts";

const clean = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

async function requireActivePost(
  ctx: AppContext,
  messageId: string,
): Promise<{ post: LfgPost; gameId: number }> {
  const post = await ctx.repos.lfg.get(messageId);
  if (!post) throw new UserFacingError("That post is no longer active.");
  if (post.gameId === null) throw new UserFacingError("This game has been removed.");
  return { post, gameId: post.gameId };
}

/** Runs tasks for the same key one after another; the map entry goes away when the chain drains. */
const chains = new Map<string, Promise<unknown>>();
function serialised<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

/**
 * Where an LFG post goes. Started from the panel or #game-roles (where members can't post), it
 * goes to #game-roles; anywhere else, it goes where it was started, but only if the member could
 * post there themselves, so the bot never posts for them in a channel they can't write in.
 */
export async function lfgChannel(
  ctx: AppContext,
  from: { channelId: string | null; memberCanSend: boolean },
): Promise<string> {
  const { panelChannelId, newsChannelId } = await ctx.repos.setup.all();
  if (
    from.channelId === null ||
    from.channelId === panelChannelId ||
    from.channelId === newsChannelId
  ) {
    if (newsChannelId === undefined) throw new UserFacingError(MESSAGES.setupFirst);
    return newsChannelId;
  }
  if (!from.memberCanSend) {
    throw new UserFacingError(
      `You can't post in this channel, so I won't post there for you. Run /lfg in a channel you can post in, or use the panel to post in #${NEWS_CHANNEL_NAME}.`,
    );
  }
  return from.channelId;
}

export async function createLfgPost(
  ctx: AppContext,
  input: {
    authorId: string;
    gameId: number;
    when: string | null;
    note: string | null;
    channelId: string;
  },
): Promise<string> {
  const when = clean(input.when);
  const note = clean(input.note);
  if (when !== null && when.length > LFG_WHEN_MAX) {
    throw new UserFacingError(`Keep 'when' under ${LFG_WHEN_MAX} characters.`);
  }
  if (note !== null && note.length > NOTE_MAX) {
    throw new UserFacingError(`Keep the note under ${NOTE_MAX} characters.`);
  }
  const game = await requireGame(ctx, input.gameId);
  await assertRoleExists(ctx, game);
  // The author is going, so they start in the In list; clicking I'm in takes them out.
  const post: Omit<LfgPost, "maybe"> = {
    messageId: "",
    channelId: input.channelId,
    gameId: game.id,
    gameName: game.name,
    authorId: input.authorId,
    when,
    note,
    createdAt: ctx.now().toISOString(),
    in: [input.authorId],
  };
  const view = lfgPostView({ ...post, maybe: [] }, game);
  const messageId = await ctx.gateway.send(input.channelId, {
    ...view,
    allowedMentions: { roles: [game.roleId], parse: [] },
  });
  try {
    await ctx.repos.lfg.add({ ...post, messageId });
  } catch (error) {
    try {
      await ctx.gateway.deleteMessage(input.channelId, messageId);
    } catch (deleteError) {
      console.error(`Could not delete orphaned LFG message ${messageId}`, deleteError);
    }
    throw error;
  }
  return messageId;
}

export function respondToLfg(
  ctx: AppContext,
  messageId: string,
  userId: string,
  clicked: LfgAnswer,
): Promise<LfgPost> {
  return serialised(messageId, async () => {
    const { post, gameId } = await requireActivePost(ctx, messageId);
    const current = post.in.includes(userId) ? "in" : post.maybe.includes(userId) ? "maybe" : null;
    await ctx.repos.lfg.setResponse(messageId, userId, toggleResponse(current, clicked));
    const updated = (await ctx.repos.lfg.get(messageId)) ?? post;
    const game = await ctx.repos.games.get(gameId);
    await ctx.gateway.edit(post.channelId, messageId, {
      ...lfgPostView(updated, game ?? null),
      allowedMentions: { parse: [] },
    });
    return updated;
  });
}

export async function joinFromLfg(
  ctx: AppContext,
  messageId: string,
  userId: string,
): Promise<"joined" | "already"> {
  const { gameId } = await requireActivePost(ctx, messageId);
  return join(ctx, userId, gameId, "lfg");
}
