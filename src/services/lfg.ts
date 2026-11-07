import type { LfgPost } from "../db/types.ts";
import { toggleResponse } from "../domain/lfg.ts";
import { UserFacingError } from "../errors.ts";
import { lfgPostView } from "../views/lfg.ts";
import type { AppContext } from "./context.ts";
import { join } from "./membership.ts";

const MAX_WHEN = 100;
const MAX_NOTE = 300;

const clean = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

async function requireActivePost(ctx: AppContext, messageId: string): Promise<LfgPost> {
  const post = await ctx.repos.lfg.get(messageId);
  if (!post) throw new UserFacingError("That post is no longer active.");
  if (post.gameId === null) throw new UserFacingError("This game has been removed.");
  return post;
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
  if (when !== null && when.length > MAX_WHEN) {
    throw new UserFacingError("Keep 'when' under 100 characters.");
  }
  if (note !== null && note.length > MAX_NOTE) {
    throw new UserFacingError("Keep the note under 300 characters.");
  }
  const game = await ctx.repos.games.get(input.gameId);
  if (!game) throw new UserFacingError("That game no longer exists.");
  if (!ctx.gateway.role(game.roleId)) {
    await ctx.audit.notifyAdmins(
      `The role for ${game.name} is missing in Discord. Remove the game or recreate it.`,
    );
    throw new UserFacingError("That game's role is missing; the admins have been told.");
  }
  const post: Omit<LfgPost, "in" | "maybe"> = {
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
  await ctx.repos.lfg.add({ ...post, messageId });
  return messageId;
}

export async function respondToLfg(
  ctx: AppContext,
  messageId: string,
  userId: string,
  clicked: "in" | "maybe",
): Promise<LfgPost> {
  const post = await requireActivePost(ctx, messageId);
  const current = post.in.includes(userId) ? "in" : post.maybe.includes(userId) ? "maybe" : null;
  await ctx.repos.lfg.setResponse(messageId, userId, toggleResponse(current, clicked));
  const updated = (await ctx.repos.lfg.get(messageId)) ?? post;
  const game = await ctx.repos.games.get(post.gameId!);
  await ctx.gateway.edit(post.channelId, messageId, {
    ...lfgPostView(updated, game ?? null),
    allowedMentions: { parse: [] },
  });
  return updated;
}

export async function joinFromLfg(
  ctx: AppContext,
  messageId: string,
  userId: string,
): Promise<"joined" | "already"> {
  const post = await requireActivePost(ctx, messageId);
  return join(ctx, userId, post.gameId!, "lfg");
}
