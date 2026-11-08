import { MessageFlags } from "discord.js";

import { MESSAGES } from "../constants.ts";
import { text, parseId } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import {
  join,
  approveSuggestion,
  closeMatches,
  editSuggestion,
  rejectSuggestion,
  requireGame,
  requirePendingSuggestion,
  submitSuggestion,
  withdrawSuggestion,
} from "../services/index.ts";
import {
  noticeView,
  FIELD,
  duplicatePromptView,
  mySuggestionsView,
  rejectModal,
  reviewEditModal,
  suggestModal,
} from "../views/index.ts";
import { forReply, noticePrivately, replyPrivately, updateWith } from "./replies.ts";
import { button, buttonOrChatInput, chatInput, modal } from "./router.ts";
import { categoriesById, joinedNotice, modalCategory } from "./shared.ts";

import type { ButtonInteraction, ChatInputCommandInteraction } from "discord.js";
import type { Category } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { AppContext } from "../services/index.ts";
import type { Handlers } from "./router.ts";

export type Draft = { name: string; categoryId: number; note: string | null };

export const DRAFT_TTL_MS = 15 * 60 * 1000;

/**
 * One pending suggestion draft per person, held while they answer "Did you mean…?".
 * Expired drafts are swept on every write. The Cancel button is the shared `cancel` kind and
 * cannot reach this store, so a cancelled draft simply expires.
 */
export const draftStore = {
  entries: new Map<string, { draft: Draft; expiresAt: number }>(),
  put(userId: string, draft: Draft, now = Date.now()): void {
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
    this.entries.set(userId, { draft, expiresAt: now + DRAFT_TTL_MS });
  },
  /** Returns a live draft without removing it. */
  get(userId: string, now = Date.now()): Draft | undefined {
    const entry = this.entries.get(userId);
    return entry !== undefined && entry.expiresAt > now ? entry.draft : undefined;
  },
  delete(userId: string): void {
    this.entries.delete(userId);
  },
};

const EXPIRED_MENU = MESSAGES.menuExpired;

async function requireCategories(ctx: AppContext): Promise<Category[]> {
  const categories = await ctx.repos.categories.list();
  if (categories.length === 0) {
    throw new UserFacingError("There are no categories yet. Ask an admin to run setup.");
  }
  return categories;
}

async function mySuggestions(ctx: AppContext, userId: string): Promise<Payload> {
  const [suggestions, categories] = await Promise.all([
    ctx.repos.suggestions.listByUser(userId),
    categoriesById(ctx),
  ]);
  return mySuggestionsView(suggestions, categories);
}

async function openSuggestForm(
  ctx: AppContext,
  interaction: ButtonInteraction | ChatInputCommandInteraction,
): Promise<void> {
  await interaction.showModal(suggestModal(await requireCategories(ctx)));
}

async function submitDraft(ctx: AppContext, userId: string, draft: Draft): Promise<string> {
  await submitSuggestion(ctx, { userId, ...draft });
  return `Suggested ${text(draft.name)}. Check its status under My suggestions.`;
}

function suggestionId(
  raw: string,
  kind:
    | "withdraw"
    | "review-approve"
    | "review-edit"
    | "review-reject"
    | "review-edit-modal"
    | "review-reject-modal",
): number {
  const id = parseId(raw);
  if (id?.kind !== kind || !("suggestionId" in id)) throw new UserFacingError(EXPIRED_MENU);
  return id.suggestionId;
}

export const suggestHandlers: Handlers = {
  "menu-suggest": buttonOrChatInput(openSuggestForm),
  "games-suggest": buttonOrChatInput(openSuggestForm),

  "menu-mysug": button(async (ctx, interaction) => {
    await updateWith(interaction, () => mySuggestions(ctx, interaction.user.id));
  }),
  "games-suggestions": chatInput(async (ctx, interaction) => {
    await interaction.reply(forReply(await mySuggestions(ctx, interaction.user.id)));
  }),

  "suggest-modal": modal(async (ctx, interaction) => {
    await replyPrivately(interaction, async () => {
      const draft: Draft = {
        name: interaction.fields.getTextInputValue(FIELD.name).trim(),
        categoryId: modalCategory(interaction),
        note: interaction.fields.getTextInputValue(FIELD.note).trim() || null,
      };
      const matches = await closeMatches(ctx, draft.name);
      if (matches.games.length > 0 || matches.pending.length > 0) {
        draftStore.put(interaction.user.id, draft);
        return duplicatePromptView(matches);
      }
      return noticeView(await submitDraft(ctx, interaction.user.id, draft));
    });
  }),

  "dup-submit": button(async (ctx, interaction) => {
    await updateWith(interaction, async () => {
      const userId = interaction.user.id;
      const draft = draftStore.get(userId);
      if (draft === undefined) {
        throw new UserFacingError("That suggestion form has expired. Please suggest again.");
      }
      // Take the draft first so a double click cannot submit twice; give it back on failure.
      draftStore.delete(userId);
      try {
        return noticeView(await submitDraft(ctx, userId, draft));
      } catch (error) {
        draftStore.put(userId, draft);
        throw error;
      }
    });
  }),

  "dup-join": button(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "dup-join") throw new UserFacingError(EXPIRED_MENU);
    await updateWith(interaction, async () => {
      const game = await requireGame(ctx, id.gameId);
      const result = await join(ctx, interaction.user.id, game.id, "suggestion");
      draftStore.delete(interaction.user.id);
      return noticeView(joinedNotice(result, game.name));
    });
  }),

  withdraw: button(async (ctx, interaction) => {
    const id = suggestionId(interaction.customId, "withdraw");
    await updateWith(interaction, async () => {
      await withdrawSuggestion(ctx, id, interaction.user.id);
      return mySuggestions(ctx, interaction.user.id);
    });
  }),

  "review-approve": button(async (ctx, interaction) => {
    const id = suggestionId(interaction.customId, "review-approve");
    await interaction.deferUpdate();
    const game = await approveSuggestion(ctx, id, interaction.user.id);
    await interaction.followUp({
      content: `Approved ${text(game.name)}.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }),
  "review-edit": button(async (ctx, interaction) => {
    const s = await requirePendingSuggestion(
      ctx,
      suggestionId(interaction.customId, "review-edit"),
    );
    await interaction.showModal(reviewEditModal(s, await requireCategories(ctx)));
  }),
  "review-reject": button(async (ctx, interaction) => {
    const s = await requirePendingSuggestion(
      ctx,
      suggestionId(interaction.customId, "review-reject"),
    );
    await interaction.showModal(rejectModal(s));
  }),
  "review-edit-modal": modal(async (ctx, interaction) => {
    const id = suggestionId(interaction.customId, "review-edit-modal");
    await noticePrivately(interaction, async () => {
      const updated = await editSuggestion(
        ctx,
        id,
        {
          name: interaction.fields.getTextInputValue(FIELD.name),
          categoryId: modalCategory(interaction),
          aliases: interaction.fields.getTextInputValue(FIELD.aliases).trim(),
        },
        interaction.user.id,
      );
      return `Saved changes to ${text(updated.name)}.`;
    });
  }),
  "review-reject-modal": modal(async (ctx, interaction) => {
    const id = suggestionId(interaction.customId, "review-reject-modal");
    await noticePrivately(interaction, async () => {
      const s = await ctx.repos.suggestions.get(id);
      await rejectSuggestion(
        ctx,
        id,
        interaction.user.id,
        interaction.fields.getTextInputValue(FIELD.reason),
      );
      return `Rejected ${text(s?.name ?? "the suggestion")}.`;
    });
  }),
};
