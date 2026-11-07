import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { Category, Suggestion } from "../db/index.ts";
import { UserFacingError } from "../errors.ts";
import type { AppContext } from "../services/index.ts";
import { join } from "../services/index.ts";
import {
  approveSuggestion,
  closeMatches,
  editSuggestion,
  rejectSuggestion,
  submitSuggestion,
  withdrawSuggestion,
} from "../services/index.ts";
import { noticeView } from "../views/index.ts";
import {
  FIELD,
  duplicatePromptView,
  mySuggestionsView,
  rejectModal,
  reviewEditModal,
  suggestModal,
} from "../views/index.ts";
import { text } from "../domain/index.ts";
import { parseId } from "../domain/index.ts";
import { forEdit, forReply } from "./member.ts";
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

const PRIVATE_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const EXPIRED_MENU = "That menu has expired. Open it again.";

async function requireCategories(ctx: AppContext): Promise<Category[]> {
  const categories = await ctx.repos.categories.list();
  if (categories.length === 0) {
    throw new UserFacingError("There are no categories yet. Ask an admin to run setup.");
  }
  return categories;
}

async function requirePendingSuggestion(ctx: AppContext, id: number): Promise<Suggestion> {
  const s = await ctx.repos.suggestions.get(id);
  if (!s) throw new UserFacingError("That suggestion no longer exists.");
  if (s.status !== "pending") {
    throw new UserFacingError(`This suggestion was already ${s.status}.`);
  }
  return s;
}

async function mySuggestions(ctx: AppContext, userId: string) {
  const [suggestions, categories] = await Promise.all([
    ctx.repos.suggestions.listByUser(userId),
    ctx.repos.categories.list(),
  ]);
  return mySuggestionsView(suggestions, new Map(categories.map((c) => [c.id, c])));
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
  if (id?.kind !== kind) throw new UserFacingError(EXPIRED_MENU);
  return (id as { suggestionId: number }).suggestionId;
}

export const suggestHandlers: Handlers = {
  "menu-suggest": openSuggestForm,
  "games-suggest": openSuggestForm,

  "menu-mysug": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(await mySuggestions(ctx, interaction.user.id)));
  },
  "games-suggestions": async (ctx, interaction: ChatInputCommandInteraction) => {
    await interaction.reply(forReply(await mySuggestions(ctx, interaction.user.id)));
  },

  "suggest-modal": async (ctx, interaction: ModalSubmitInteraction) => {
    await interaction.deferReply({ flags: PRIVATE_V2 });
    const categoryId = Number(interaction.fields.getStringSelectValues(FIELD.category)[0]);
    if (!Number.isInteger(categoryId)) throw new UserFacingError("Pick a category.");
    const draft: Draft = {
      name: interaction.fields.getTextInputValue(FIELD.name).trim(),
      categoryId,
      note: interaction.fields.getTextInputValue(FIELD.note).trim() || null,
    };
    const matches = await closeMatches(ctx, draft.name);
    if (matches.games.length > 0 || matches.pending.length > 0) {
      draftStore.put(interaction.user.id, draft);
      await interaction.editReply(forEdit(duplicatePromptView(matches)));
      return;
    }
    await interaction.editReply(
      forEdit(noticeView(await submitDraft(ctx, interaction.user.id, draft))),
    );
  },

  "dup-submit": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    const userId = interaction.user.id;
    const draft = draftStore.get(userId);
    if (draft === undefined) {
      throw new UserFacingError("That suggestion form has expired. Please suggest again.");
    }
    // Take the draft first so a double click cannot submit twice; give it back on failure.
    draftStore.delete(userId);
    try {
      await interaction.editReply(forEdit(noticeView(await submitDraft(ctx, userId, draft))));
    } catch (error) {
      draftStore.put(userId, draft);
      throw error;
    }
  },

  "dup-join": async (ctx, interaction: ButtonInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "dup-join") throw new UserFacingError(EXPIRED_MENU);
    await interaction.deferUpdate();
    const game = await ctx.repos.games.get(id.gameId);
    if (!game) throw new UserFacingError("That game no longer exists.");
    const result = await join(ctx, interaction.user.id, game.id, "suggestion");
    draftStore.delete(interaction.user.id);
    const name = text(game.name);
    await interaction.editReply(
      forEdit(
        noticeView(result === "joined" ? `You've joined ${name}.` : `You already have ${name}.`),
      ),
    );
  },

  withdraw: async (ctx, interaction: ButtonInteraction) => {
    const id = suggestionId(interaction.customId, "withdraw");
    await interaction.deferUpdate();
    await withdrawSuggestion(ctx, id, interaction.user.id);
    await interaction.editReply(forEdit(await mySuggestions(ctx, interaction.user.id)));
  },

  "review-approve": async (ctx, interaction: ButtonInteraction) => {
    const id = suggestionId(interaction.customId, "review-approve");
    await interaction.deferUpdate();
    const game = await approveSuggestion(ctx, id, interaction.user.id);
    await interaction.followUp({
      content: `Approved ${text(game.name)}.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
  "review-edit": async (ctx, interaction: ButtonInteraction) => {
    const s = await requirePendingSuggestion(
      ctx,
      suggestionId(interaction.customId, "review-edit"),
    );
    await interaction.showModal(reviewEditModal(s, await requireCategories(ctx)));
  },
  "review-reject": async (ctx, interaction: ButtonInteraction) => {
    const s = await requirePendingSuggestion(
      ctx,
      suggestionId(interaction.customId, "review-reject"),
    );
    await interaction.showModal(rejectModal(s));
  },
  "review-edit-modal": async (ctx, interaction: ModalSubmitInteraction) => {
    const id = suggestionId(interaction.customId, "review-edit-modal");
    await interaction.deferReply({ flags: PRIVATE_V2 });
    const categoryId = Number(interaction.fields.getStringSelectValues(FIELD.category)[0]);
    if (!Number.isInteger(categoryId)) throw new UserFacingError("Pick a category.");
    const updated = await editSuggestion(
      ctx,
      id,
      {
        name: interaction.fields.getTextInputValue(FIELD.name),
        categoryId,
        aliases: interaction.fields.getTextInputValue(FIELD.aliases).trim(),
      },
      interaction.user.id,
    );
    await interaction.editReply(forEdit(noticeView(`Saved changes to ${text(updated.name)}.`)));
  },
  "review-reject-modal": async (ctx, interaction: ModalSubmitInteraction) => {
    const id = suggestionId(interaction.customId, "review-reject-modal");
    await interaction.deferReply({ flags: PRIVATE_V2 });
    const s = await ctx.repos.suggestions.get(id);
    await rejectSuggestion(
      ctx,
      id,
      interaction.user.id,
      interaction.fields.getTextInputValue(FIELD.reason),
    );
    await interaction.editReply(
      forEdit(noticeView(`Rejected ${text(s?.name ?? "the suggestion")}.`)),
    );
  },
};
