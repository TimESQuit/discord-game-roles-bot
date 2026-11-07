import { LFG_WHEN_MAX, MESSAGES, NOTE_MAX } from "../constants.ts";
import type { LfgAnswer, LfgPost } from "../db/index.ts";
import { toggleResponse } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { lfgPostView } from "../views/index.ts";
import type { AppContext } from "./context.ts";
import { join } from "./membership.ts";

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
  const game = await ctx.repos.games.get(input.gameId);
  if (!game) throw new UserFacingError(MESSAGES.gameGone);
  if (!ctx.gateway.role(game.roleId)) {
    await ctx.audit.notifyAdmins(
      `The role for ${game.name} is missing in Discord. Remove the game or recreate it.`,
    );
    throw new UserFacingError(MESSAGES.gameRoleMissing);
  }
  const post: Omit<LfgPost, LfgAnswer> = {
    messageId: "",
    channelId: input.channelId,
    gameId: game.id,
    gameName: game.name,
    authorId: input.authorId,
    when,
    note,
    createdAt: ctx.now().toISOString(),
  };
  const view = lfgPostView({ ...post, in: [], maybe: [] }, game);
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
