import {
  AUTOCOMPLETE_CHOICE_LIMIT,
  BACKUPS_CHANNEL_NAME,
  MESSAGES,
  MOVE_DIRECTIONS,
} from "../constants.ts";
import {
  validateCategoryName,
  diffGameEdit,
  text,
  parseId,
  choicesFromBits,
  choicesFromValues,
} from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import { normalize } from "../normalize.ts";
import {
  runBackup,
  addGame,
  editGame,
  reapplyTemplate,
  removeGame,
  autocompleteGames,
  applySetup,
  applyUninstall,
  leaveServer,
  previewSetup,
  previewUninstall,
  refreshPanel,
  requireCategory,
  requireGame,
} from "../services/index.ts";
import {
  categoriesView,
  categoryModal,
  confirmRemoveView,
  gameModal,
  reviewListView,
  setupPreviewView,
  setupReportView,
  noticeView,
  uninstallPreviewView,
  uninstallReportView,
  FIELD,
} from "../views/index.ts";
import { openMenus } from "./menus.ts";
import { parseCategoryId } from "./parse.ts";
import { forEdit, noticePrivately, replyPrivately, showPrivately, updateWith } from "./replies.ts";
import { buttonOrChatInput, autocomplete, button, chatInput, modal, select } from "./router.ts";
import {
  categoriesById,
  choices,
  enclosingChannelId,
  gamePicker,
  modalCategory,
  resolvePickedGame,
} from "./shared.ts";

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { MoveDirection } from "../constants.ts";
import type { Category, Game } from "../db/index.ts";
import type { Payload } from "../discord/index.ts";
import type { UninstallChoices } from "../domain/index.ts";
import type { AppContext } from "../services/index.ts";
import type { Handlers } from "./router.ts";

const EXPIRED_FORM = MESSAGES.formExpired;

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
  if (name === category.name) return MESSAGES.nothingChanged;
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
  dir: MoveDirection,
  actorId: string,
): Promise<string> {
  const categories = await ctx.repos.categories.list();
  const index = categories.findIndex((c) => c.id === categoryId);
  const category = categories[index];
  if (!category) throw new UserFacingError(MESSAGES.categoryGone);
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
  if (Object.keys(patch).length === 0) return MESSAGES.nothingChanged;
  const after = await editGame(ctx, game.id, patch, actorId);
  return `Saved changes to ${text(after.name)}.`;
}

const showCategories = async (ctx: AppContext): Promise<Payload> =>
  categoriesView(await ctx.repos.categories.list());

async function pendingReview(ctx: AppContext): Promise<Payload> {
  const [pending, categories] = await Promise.all([
    ctx.repos.suggestions.listPending(),
    categoriesById(ctx),
  ]);
  return reviewListView(pending, categories);
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

function confirmRemove(ctx: AppContext, game: Parameters<typeof confirmRemoveView>[0]) {
  return confirmRemoveView(game, ctx.gateway.roleMemberIds(game.roleId).length);
}

/** A category modal opened from the categories view updates that message; otherwise it replies. */
async function answerCategoryModal(
  ctx: AppContext,
  interaction: ModalSubmitInteraction,
  run: () => Promise<string>,
): Promise<void> {
  if (interaction.isFromMessage()) {
    await updateWith(interaction, async () => {
      await run();
      return showCategories(ctx);
    });
  } else {
    await noticePrivately(interaction, run);
  }
}

async function previewInto(
  ctx: AppContext,
  interaction: ButtonInteraction | ChatInputCommandInteraction,
): Promise<void> {
  await replyPrivately(interaction, async () => {
    const { problems, plan } = await previewSetup(ctx);
    return setupPreviewView(problems, plan);
  });
}

const uninstallPreview = async (
  ctx: AppContext,
  channelId: string | null,
  picked: UninstallChoices,
): Promise<Payload> => uninstallPreviewView(await previewUninstall(ctx, channelId), picked);

const reapply = (ctx: AppContext, userId: string) => async () =>
  `Re-applied the template to ${String(await reapplyTemplate(ctx, userId))} game roles.`;

const refresh = (ctx: AppContext, userId: string) => async () =>
  (await refreshPanel(ctx, userId)) === "updated" ? "Panel updated." : "Panel reposted.";

const backup = (ctx: AppContext, userId: string) => async () => {
  await runBackup(ctx, ctx.db, userId);
  return `Backup posted to #${BACKUPS_CHANNEL_NAME}.`;
};

const privateAction = (make: (ctx: AppContext, userId: string) => () => Promise<string>) =>
  buttonOrChatInput((ctx, interaction) =>
    noticePrivately(interaction, make(ctx, interaction.user.id)),
  );

export const adminHandlers: Handlers = {
  "admin-review": button(async (ctx, interaction) => {
    await updateWith(interaction, () => pendingReview(ctx));
  }),
  "gameadmin-review": chatInput(async (ctx, interaction) => {
    await showPrivately(interaction, await pendingReview(ctx));
  }),

  "admin-add": button((ctx, interaction) => openGameModal(ctx, interaction)),
  "admin-edit": button(async (ctx, interaction) => {
    await updateWith(interaction, () => gamePicker(ctx, "edit"));
  }),
  "admin-remove": button(async (ctx, interaction) => {
    await updateWith(interaction, () => gamePicker(ctx, "remove"));
  }),
  "admin-categories": button(async (ctx, interaction) => {
    await updateWith(interaction, () => showCategories(ctx));
  }),
  "admin-reapply": privateAction(reapply),
  "admin-refresh": privateAction(refresh),
  "admin-backup": privateAction(backup),
  "admin-setup": buttonOrChatInput(previewInto),

  "pick-edit": select(async (ctx, interaction) => {
    const game = await resolvePickedGame(ctx, interaction.values[0]);
    await openGameModal(ctx, interaction, game);
  }),
  "pick-remove": select(async (ctx, interaction) => {
    await updateWith(interaction, async () =>
      confirmRemove(ctx, await resolvePickedGame(ctx, interaction.values[0])),
    );
  }),

  "game-add-modal": modal(async (ctx, interaction) => {
    if (parseId(interaction.customId)?.kind !== "game-add-modal") {
      throw new UserFacingError(EXPIRED_FORM);
    }
    await noticePrivately(interaction, async () => {
      const game = await addGame(ctx, {
        name: interaction.fields.getTextInputValue(FIELD.name),
        categoryId: modalCategory(interaction),
        aliases: interaction.fields.getTextInputValue(FIELD.aliases),
        actorId: interaction.user.id,
      });
      return `Added ${text(game.name)}.`;
    });
  }),
  "game-edit-modal": modal(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "game-edit-modal") throw new UserFacingError(EXPIRED_FORM);
    await noticePrivately(interaction, async () => {
      const game = await requireGame(ctx, id.gameId);
      // Aliases are left out of the modal when they are too long to prefill.
      const patch = diffGameEdit(game, {
        name: interaction.fields.getTextInputValue(FIELD.name),
        categoryId: modalCategory(interaction),
        ...(interaction.fields.fields.has(FIELD.aliases)
          ? { aliases: interaction.fields.getTextInputValue(FIELD.aliases) }
          : {}),
      });
      return saveEdit(ctx, game, patch, interaction.user.id);
    });
  }),
  "confirm-remove": button(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "confirm-remove") throw new UserFacingError(EXPIRED_FORM);
    await updateWith(interaction, async () => {
      const { game } = await removeGame(ctx, id.gameId, interaction.user.id);
      return noticeView(`Removed ${text(game.name)}.`);
    });
  }),
  "confirm-setup": button(async (ctx, interaction) => {
    await updateWith(interaction, async () =>
      setupReportView(await applySetup(ctx, interaction.user.id)),
    );
  }),

  "gameadmin-uninstall": chatInput(async (ctx, interaction) => {
    await replyPrivately(interaction, () =>
      uninstallPreview(ctx, enclosingChannelId(interaction), new Set()),
    );
  }),
  "uninstall-options": select(async (ctx, interaction) => {
    await updateWith(interaction, () =>
      uninstallPreview(ctx, enclosingChannelId(interaction), choicesFromValues(interaction.values)),
    );
  }),
  "uninstall-confirm": button(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "uninstall-confirm") throw new UserFacingError(MESSAGES.menuExpired);
    const picked = choicesFromBits(id.choices);
    await interaction.deferUpdate();
    await applyUninstall(
      ctx,
      interaction.user.id,
      picked,
      enclosingChannelId(interaction),
      async (result) => {
        await interaction.editReply(forEdit(uninstallReportView(result, picked)));
        // The report carries the backup, so opening another menu must not delete it.
        openMenus.forget(interaction.user.id, interaction.message.id);
      },
    );
    // Last, once the report and backup have reached the admin.
    if (picked.has("leave")) await leaveServer(ctx);
  }),

  "category-add": button(async (_ctx, interaction) => {
    await interaction.showModal(categoryModal());
  }),
  "category-rename": button(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "category-rename") throw new UserFacingError(EXPIRED_FORM);
    await interaction.showModal(categoryModal(await requireCategory(ctx, id.categoryId)));
  }),
  "category-add-modal": modal(async (ctx, interaction) => {
    if (parseId(interaction.customId)?.kind !== "category-add-modal") {
      throw new UserFacingError(EXPIRED_FORM);
    }
    await answerCategoryModal(ctx, interaction, () =>
      addCategory(ctx, interaction.fields.getTextInputValue(FIELD.name), interaction.user.id),
    );
  }),
  "category-rename-modal": modal(async (ctx, interaction) => {
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
  }),
  "category-move": button(async (ctx, interaction) => {
    const id = parseId(interaction.customId);
    if (id?.kind !== "category-move") throw new UserFacingError(EXPIRED_FORM);
    await updateWith(interaction, async () => {
      await moveCategory(ctx, id.categoryId, id.dir, interaction.user.id);
      return showCategories(ctx);
    });
  }),

  "gameadmin-setup": buttonOrChatInput(previewInto),
  "gameadmin-backup": privateAction(backup),
  "gameadmin-reapply-template": privateAction(reapply),
  "gameadmin-refresh-panel": privateAction(refresh),

  "gameadmin-add": chatInput(async (ctx, interaction) => {
    const categoryId = parseCategoryId(interaction.options.getString("category", true));
    await noticePrivately(interaction, async () => {
      const game = await addGame(ctx, {
        name: interaction.options.getString("name", true),
        categoryId,
        aliases: interaction.options.getString("aliases") ?? "",
        actorId: interaction.user.id,
      });
      return `Added ${text(game.name)}.`;
    });
  }),
  "gameadmin-edit": chatInput(async (ctx, interaction) => {
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
    await noticePrivately(interaction, () => saveEdit(ctx, game, patch, interaction.user.id));
  }),
  "gameadmin-remove": chatInput(async (ctx, interaction) => {
    const game = await resolvePickedGame(ctx, interaction.options.getString("game", true));
    await showPrivately(interaction, confirmRemove(ctx, game));
  }),

  "gameadmin-category-add": chatInput(async (ctx, interaction) => {
    await noticePrivately(interaction, () =>
      addCategory(ctx, interaction.options.getString("name", true), interaction.user.id),
    );
  }),
  "gameadmin-category-rename": chatInput(async (ctx, interaction) => {
    const categoryId = parseCategoryId(interaction.options.getString("category", true));
    await noticePrivately(interaction, () =>
      renameCategory(
        ctx,
        categoryId,
        interaction.options.getString("name", true),
        interaction.user.id,
      ),
    );
  }),
  "gameadmin-category-move": chatInput(async (ctx, interaction) => {
    const categoryId = parseCategoryId(interaction.options.getString("category", true));
    const dir = interaction.options.getString("direction", true);
    const direction = MOVE_DIRECTIONS.find((d) => d === dir);
    if (direction === undefined) throw new UserFacingError("Pick up or down.");
    await noticePrivately(interaction, () =>
      moveCategory(ctx, categoryId, direction, interaction.user.id),
    );
  }),

  "autocomplete-gameadmin": autocomplete(async (ctx, interaction) => {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "game") {
      const matches = await autocompleteGames(ctx, interaction.user.id, focused.value, "any");
      await interaction.respond(choices(matches));
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
        .slice(0, AUTOCOMPLETE_CHOICE_LIMIT);
      await interaction.respond(choices(matches));
    } else {
      await interaction.respond([]);
    }
  }),
};
