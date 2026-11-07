import {
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Category, Game } from "../db/index.ts";
import { validateCategoryName, diffGameEdit, text, parseId } from "../domain/index.ts";
import { normalize } from "../normalize.ts";
import { UserFacingError } from "../errors.ts";
import {
  runBackup,
  addGame,
  editGame,
  reapplyTemplate,
  removeGame,
  autocompleteGames,
  applySetup,
  previewSetup,
  refreshPanel,
  type AppContext,
} from "../services/index.ts";
import {
  categoriesView,
  categoryModal,
  confirmRemoveView,
  gameModal,
  reviewListView,
  setupPreviewView,
  setupReportView,
  truncate,
  noticeView,
  pickGameView,
  FIELD,
} from "../views/index.ts";
import { parsePositiveId } from "./parse.ts";
import { resolvePickedGame } from "./lfg.ts";
import { PRIVATE_V2_DEFER, forEdit, forReply } from "./replies.ts";
import type { Handlers } from "./router.ts";

const EXPIRED_FORM = "That form has expired. Open it again.";
const BAD_CATEGORY = "Pick a category from the list.";

export const parseCategoryId = (raw: string | undefined): number =>
  parsePositiveId(raw, BAD_CATEGORY);

async function requireCategory(ctx: AppContext, id: number): Promise<Category> {
  const category = await ctx.repos.categories.get(id);
  if (!category) throw new UserFacingError("That category doesn't exist.");
  return category;
}

async function addCategory(ctx: AppContext, rawName: string, actorId: string): Promise<string> {
  const name = validateCategoryName(rawName, await ctx.repos.categories.list());
  await ctx.repos.categories.add(name);
  await ctx.audit.log({ kind: "category-changed", userId: actorId, detail: `added ${name}` });
  return `Added the category ${text(name)}.`;
}

async function renameCategory(
  ctx: AppContext,
  categoryId: number,
  rawName: string,
  actorId: string,
): Promise<string> {
  const category = await requireCategory(ctx, categoryId);
  const name = validateCategoryName(rawName, await ctx.repos.categories.list(), categoryId);
  if (name === category.name) return "Nothing changed.";
  await ctx.repos.categories.rename(categoryId, name);
  await ctx.audit.log({
    kind: "category-changed",
    userId: actorId,
    detail: `renamed ${category.name} → ${name}`,
  });
  return `Renamed ${text(category.name)} to ${text(name)}.`;
}

async function moveCategory(
  ctx: AppContext,
  categoryId: number,
  dir: "up" | "down",
  actorId: string,
): Promise<string> {
  const categories = await ctx.repos.categories.list();
  const index = categories.findIndex((c) => c.id === categoryId);
  const category = categories[index];
  if (!category) throw new UserFacingError("That category doesn't exist.");
  if (dir === "up" ? index === 0 : index === categories.length - 1) {
    throw new UserFacingError(
      `${text(category.name)} is already ${dir === "up" ? "first" : "last"}.`,
    );
  }
  await ctx.repos.categories.move(categoryId, dir);
  await ctx.audit.log({
    kind: "category-changed",
    userId: actorId,
    detail: `moved ${category.name} ${dir}`,
  });
  return `Moved ${text(category.name)} ${dir}.`;
}

async function saveEdit(
  ctx: AppContext,
  game: Game,
  patch: ReturnType<typeof diffGameEdit>,
  actorId: string,
): Promise<string> {
  if (Object.keys(patch).length === 0) return "Nothing changed.";
  const after = await editGame(ctx, game.id, patch, actorId);
  return `Saved changes to ${text(after.name)}.`;
}

const showCategories = async (ctx: AppContext) => categoriesView(await ctx.repos.categories.list());

async function pendingReview(ctx: AppContext) {
  const [pending, categories] = await Promise.all([
    ctx.repos.suggestions.listPending(),
    ctx.repos.categories.list(),
  ]);
  return reviewListView(pending, new Map(categories.map((c) => [c.id, c])));
}

async function openGameModal(
  ctx: AppContext,
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  game?: Parameters<typeof gameModal>[1],
): Promise<void> {
  const categories = await ctx.repos.categories.list();
  if (categories.length === 0) {
    throw new UserFacingError("There are no categories yet. Run setup first.");
  }
  await interaction.showModal(gameModal(categories, game));
}

async function pickerView(ctx: AppContext, purpose: "edit" | "remove") {
  const [categories, games] = await Promise.all([
    ctx.repos.categories.list(),
    ctx.repos.games.list(),
  ]);
  return pickGameView(purpose, categories, games);
}

function confirmRemove(ctx: AppContext, game: Parameters<typeof confirmRemoveView>[0]) {
  return confirmRemoveView(game, ctx.gateway.roleMemberIds(game.roleId).length);
}

/** A category modal opened from the categories view updates that message; otherwise it replies. */
async function answerCategoryModal(
  ctx: AppContext,
  interaction: ModalSubmitInteraction,
  run: () => Promise<string>,
): Promise<void> {
  const fromMenu = interaction.isFromMessage();
  if (fromMenu) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
  const notice = await run();
  await interaction.editReply(forEdit(fromMenu ? await showCategories(ctx) : noticeView(notice)));
}

async function replyPrivately(
  interaction: ChatInputCommandInteraction,
  run: () => Promise<string>,
): Promise<void> {
  await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
  await interaction.editReply(forEdit(noticeView(await run())));
}

async function previewInto(
  ctx: AppContext,
  interaction: ButtonInteraction | ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
  const { problems, plan } = await previewSetup(ctx);
  await interaction.editReply(forEdit(setupPreviewView(problems, plan)));
}

const reapply = (ctx: AppContext, userId: string) => async () =>
  `Re-applied the template to ${String(await reapplyTemplate(ctx, userId))} game roles.`;

const refresh = (ctx: AppContext, userId: string) => async () =>
  (await refreshPanel(ctx, userId)) === "updated" ? "Panel updated." : "Panel reposted.";

const backup = (ctx: AppContext, userId: string) => async () => {
  await runBackup(ctx, ctx.db, userId);
  return "Backup posted to #bot-backups.";
};

type AnyInteraction = ButtonInteraction | ChatInputCommandInteraction;
const privateAction =
  (make: (ctx: AppContext, userId: string) => () => Promise<string>) =>
  async (ctx: AppContext, interaction: AnyInteraction): Promise<void> => {
    await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
    await interaction.editReply(forEdit(noticeView(await make(ctx, interaction.user.id)())));
  };

function modalCategory(interaction: ModalSubmitInteraction): number {
  return parseCategoryId(interaction.fields.getStringSelectValues(FIELD.category)[0]);
}

export const adminHandlers: Handlers = {
  "admin-review": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(await pendingReview(ctx)));
  },
  "gameadmin-review": async (ctx, interaction: ChatInputCommandInteraction) => {
    await interaction.reply(forReply(await pendingReview(ctx)));
  },

  "admin-add": (ctx, interaction: ButtonInteraction) => openGameModal(ctx, interaction),
  "admin-edit": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(await pickerView(ctx, "edit")));
  },
  "admin-remove": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(await pickerView(ctx, "remove")));
  },
  "admin-categories": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    await interaction.editReply(forEdit(await showCategories(ctx)));
  },
  "admin-reapply": privateAction(reapply),
  "admin-refresh": privateAction(refresh),
  "admin-backup": privateAction(backup),
  "admin-setup": previewInto,

  "pick-edit": async (ctx, interaction: StringSelectMenuInteraction) => {
    const game = await resolvePickedGame(ctx, interaction.values[0]);
    await openGameModal(ctx, interaction, game);
  },
  "pick-remove": async (ctx, interaction: StringSelectMenuInteraction) => {
    await interaction.deferUpdate();
    const game = await resolvePickedGame(ctx, interaction.values[0]);
    await interaction.editReply(forEdit(confirmRemove(ctx, game)));
  },

  "game-add-modal": async (ctx, interaction: ModalSubmitInteraction) => {
    if (parseId(interaction.customId)?.kind !== "game-add-modal") {
      throw new UserFacingError(EXPIRED_FORM);
    }
    await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
    const game = await addGame(ctx, {
      name: interaction.fields.getTextInputValue(FIELD.name),
      categoryId: modalCategory(interaction),
      aliases: interaction.fields.getTextInputValue(FIELD.aliases),
      actorId: interaction.user.id,
    });
    await interaction.editReply(forEdit(noticeView(`Added ${text(game.name)}.`)));
  },
  "game-edit-modal": async (ctx, interaction: ModalSubmitInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "game-edit-modal") throw new UserFacingError(EXPIRED_FORM);
    await interaction.deferReply({ flags: PRIVATE_V2_DEFER });
    const game = await ctx.repos.games.get(id.gameId);
    if (!game) throw new UserFacingError("That game no longer exists.");
    // Aliases are left out of the modal when they are too long to prefill.
    const patch = diffGameEdit(game, {
      name: interaction.fields.getTextInputValue(FIELD.name),
      categoryId: modalCategory(interaction),
      ...(interaction.fields.fields.has(FIELD.aliases)
        ? { aliases: interaction.fields.getTextInputValue(FIELD.aliases) }
        : {}),
    });
    await interaction.editReply(
      forEdit(noticeView(await saveEdit(ctx, game, patch, interaction.user.id))),
    );
  },
  "confirm-remove": async (ctx, interaction: ButtonInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "confirm-remove") throw new UserFacingError(EXPIRED_FORM);
    await interaction.deferUpdate();
    const { game } = await removeGame(ctx, id.gameId, interaction.user.id);
    await interaction.editReply(forEdit(noticeView(`Removed ${text(game.name)}.`)));
  },
  "confirm-setup": async (ctx, interaction: ButtonInteraction) => {
    await interaction.deferUpdate();
    const result = await applySetup(ctx, interaction.user.id);
    await interaction.editReply(forEdit(setupReportView(result)));
  },

  "category-add": async (_ctx, interaction: ButtonInteraction) => {
    await interaction.showModal(categoryModal());
  },
  "category-rename": async (ctx, interaction: ButtonInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "category-rename") throw new UserFacingError(EXPIRED_FORM);
    await interaction.showModal(categoryModal(await requireCategory(ctx, id.categoryId)));
  },
  "category-add-modal": async (ctx, interaction: ModalSubmitInteraction) => {
    if (parseId(interaction.customId)?.kind !== "category-add-modal") {
      throw new UserFacingError(EXPIRED_FORM);
    }
    await answerCategoryModal(ctx, interaction, () =>
      addCategory(ctx, interaction.fields.getTextInputValue(FIELD.name), interaction.user.id),
    );
  },
  "category-rename-modal": async (ctx, interaction: ModalSubmitInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "category-rename-modal") throw new UserFacingError(EXPIRED_FORM);
    await answerCategoryModal(ctx, interaction, () =>
      renameCategory(
        ctx,
        id.categoryId,
        interaction.fields.getTextInputValue(FIELD.name),
        interaction.user.id,
      ),
    );
  },
  "category-move": async (ctx, interaction: ButtonInteraction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "category-move") throw new UserFacingError(EXPIRED_FORM);
    await interaction.deferUpdate();
    await moveCategory(ctx, id.categoryId, id.dir, interaction.user.id);
    await interaction.editReply(forEdit(await showCategories(ctx)));
  },

  "gameadmin-setup": previewInto,
  "gameadmin-backup": privateAction(backup),
  "gameadmin-reapply-template": privateAction(reapply),
  "gameadmin-refresh-panel": privateAction(refresh),

  "gameadmin-add": async (ctx, interaction: ChatInputCommandInteraction) => {
    const categoryId = parseCategoryId(interaction.options.getString("category", true));
    await replyPrivately(interaction, async () => {
      const game = await addGame(ctx, {
        name: interaction.options.getString("name", true),
        categoryId,
        aliases: interaction.options.getString("aliases") ?? "",
        actorId: interaction.user.id,
      });
      return `Added ${text(game.name)}.`;
    });
  },
  "gameadmin-edit": async (ctx, interaction: ChatInputCommandInteraction) => {
    const { options } = interaction;
    const name = options.getString("name");
    const category = options.getString("category");
    const aliases = options.getString("aliases");
    if (name === null && category === null && aliases === null) {
      throw new UserFacingError("Nothing to change.");
    }
    const game = await resolvePickedGame(ctx, options.getString("game", true));
    const categoryId = category === null ? undefined : parseCategoryId(category);
    const patch = diffGameEdit(game, {
      ...(name === null ? {} : { name }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(aliases === null ? {} : { aliases }),
    });
    await replyPrivately(interaction, () => saveEdit(ctx, game, patch, interaction.user.id));
  },
  "gameadmin-remove": async (ctx, interaction: ChatInputCommandInteraction) => {
    const game = await resolvePickedGame(ctx, interaction.options.getString("game", true));
    await interaction.reply(forReply(confirmRemove(ctx, game)));
  },

  "gameadmin-category-add": async (ctx, interaction: ChatInputCommandInteraction) => {
    await replyPrivately(interaction, () =>
      addCategory(ctx, interaction.options.getString("name", true), interaction.user.id),
    );
  },
  "gameadmin-category-rename": async (ctx, interaction: ChatInputCommandInteraction) => {
    const categoryId = parseCategoryId(interaction.options.getString("category", true));
    await replyPrivately(interaction, () =>
      renameCategory(
        ctx,
        categoryId,
        interaction.options.getString("name", true),
        interaction.user.id,
      ),
    );
  },
  "gameadmin-category-move": async (ctx, interaction: ChatInputCommandInteraction) => {
    const categoryId = parseCategoryId(interaction.options.getString("category", true));
    const dir = interaction.options.getString("direction", true);
    if (dir !== "up" && dir !== "down") throw new UserFacingError("Pick up or down.");
    await replyPrivately(interaction, () =>
      moveCategory(ctx, categoryId, dir, interaction.user.id),
    );
  },

  "autocomplete-gameadmin": async (ctx, interaction: AutocompleteInteraction) => {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "game") {
      const matches = await autocompleteGames(ctx, interaction.user.id, focused.value, "any");
      await interaction.respond(
        matches.map((g) => ({ name: truncate(g.name, 100), value: String(g.id) })),
      );
    } else if (focused.name === "category") {
      const query = normalize(focused.value);
      const categories = await ctx.repos.categories.list();
      const rank = (c: Category): number => {
        const n = normalize(c.name);
        return n.startsWith(query) ? 0 : n.includes(query) ? 1 : 2;
      };
      const matches = categories
        .filter((c) => rank(c) < 2)
        .toSorted((a, b) => rank(a) - rank(b) || a.position - b.position)
        .slice(0, 25);
      await interaction.respond(
        matches.map((c) => ({ name: truncate(c.name, 100), value: String(c.id) })),
      );
    } else {
      await interaction.respond([]);
    }
  },
};
