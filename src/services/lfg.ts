import { LFG_WHEN_MAX, MESSAGES, NEWS_CHANNEL_NAME, NOTE_MAX } from "../constants.ts";
import { openLfgPost, toggleResponse } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { lfgClosedView, lfgPostView } from "../views/index.ts";
import { serialised } from "./concurrency.ts";
import { requireGame } from "./lookups.ts";
import { addRole, assertRoleExists, removeRole } from "./membership.ts";

import type { LfgAnswer, LfgOutcome, LfgPost } from "../db/index.ts";
import type { AppContext } from "./context.ts";

const clean = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** Why a click on an LFG post, or on its Manage menu, did nothing. */
export const LFG_REFUSALS = {
  gone: "That post is no longer active.",
  finished: "This post is finished.",
  cancelled: "This post was cancelled.",
  gameRemoved: "This game has been removed.",
  notAllowed: "You don't have permission for this action.",
} as const;

/** Who clicked, and whether they hold the admin role. */
export type LfgActor = { userId: string; isAdmin: boolean };

/** Why a post that isn't open can't be acted on: it's gone, finished or cancelled. */
const refusalFor = (post: LfgPost | undefined): string =>
  post && post.status !== "open" ? LFG_REFUSALS[post.status] : LFG_REFUSALS.gone;

/** The post, if it exists and hasn't been finished or cancelled. */
async function requireOpenPost(ctx: AppContext, messageId: string): Promise<LfgPost> {
  const post = await ctx.repos.lfg.get(messageId);
  if (post?.status !== "open") throw new UserFacingError(refusalFor(post));
  return post;
}

/** An open post whose game still exists, for the buttons that act on the game. */
async function requireActivePost(
  ctx: AppContext,
  messageId: string,
): Promise<{ post: LfgPost; gameId: number }> {
  const post = await requireOpenPost(ctx, messageId);
  if (post.gameId === null) throw new UserFacingError(LFG_REFUSALS.gameRemoved);
  return { post, gameId: post.gameId };
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
  const post = openLfgPost({
    messageId: "",
    channelId: input.channelId,
    gameId: game.id,
    gameName: game.name,
    authorId: input.authorId,
    when,
    note,
    createdAt: ctx.now().toISOString(),
    in: [input.authorId],
  });
  const view = lfgPostView(post, game);
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

/**
 * Joins the post's game role, or leaves it if the member already has it. Reads the member's roles
 * from Discord rather than the cache, which lags behind the bot's own role changes, and takes one
 * click per member at a time, so a double-click joins then leaves instead of joining twice.
 */
export function toggleRoleFromLfg(
  ctx: AppContext,
  messageId: string,
  userId: string,
): Promise<{ result: "joined" | "left"; gameName: string }> {
  return serialised(`role:${userId}`, async () => {
    const { gameId } = await requireActivePost(ctx, messageId);
    const game = await requireGame(ctx, gameId);
    if ((await ctx.gateway.fetchMemberRoleIds(userId)).has(game.roleId)) {
      await removeRole(ctx, userId, game, "lfg");
      return { result: "left", gameName: game.name };
    }
    await assertRoleExists(ctx, game);
    await addRole(ctx, userId, game, "lfg");
    return { result: "joined", gameName: game.name };
  });
}

/** The open post, if `actor` started it or is an admin; only they may finish or cancel it. */
export async function lfgPostToManage(
  ctx: AppContext,
  messageId: string,
  actor: LfgActor,
): Promise<LfgPost> {
  const post = await requireOpenPost(ctx, messageId);
  if (post.authorId !== actor.userId && !actor.isAdmin) {
    throw new UserFacingError(LFG_REFUSALS.notAllowed);
  }
  return post;
}

/**
 * Finishes or cancels a post: it's stored as closed, its message shrinks to one line (plus who
 * went, when finished) with no buttons, and it's logged. Queued with the post's responses, so a
 * click landing at the same moment can't redraw the buttons afterwards. If the message can't be
 * redrawn, the post is reopened, so its buttons keep working and closing it can be tried again.
 */
export function closeLfgPost(
  ctx: AppContext,
  messageId: string,
  actor: LfgActor,
  outcome: LfgOutcome,
): Promise<void> {
  return serialised(messageId, async () => {
    const post = await lfgPostToManage(ctx, messageId, actor);
    if (!(await ctx.repos.lfg.close(messageId, outcome, actor.userId, ctx.now().toISOString()))) {
      throw new UserFacingError(refusalFor(await ctx.repos.lfg.get(messageId)));
    }
    try {
      await ctx.gateway.edit(post.channelId, messageId, lfgClosedView(post, outcome, actor.userId));
    } catch (error) {
      await ctx.repos.lfg.reopen(messageId);
      throw error;
    }
    await ctx.audit.log({
      kind: "lfg-closed",
      userId: actor.userId,
      authorId: post.authorId,
      game: post.gameName,
      outcome,
    });
  });
}
