import { BACKUPS_CHANNEL_NAME, MESSAGES, MOVE_DIRECTIONS } from "../constants.ts";
import { text, choicesFromBits, choicesFromValues, rankCategories } from "../domain/index.ts";
import { UserFacingError } from "../errors.ts";
import {
  runBackup,
  addCategory,
  addGame,
  editGame,
  moveCategory,
  renameCategory,
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
import { idOf, parseCategoryId, parseGameId } from "./parse.ts";
import {
  deferAndKeep,
  forEdit,
  noticePrivately,
  replyPrivately,
  showPrivately,
  updateWith,
} from "./replies.ts";
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
import type { Payload } from "../discord/index.ts";
import type { UninstallChoices } from "../domain/index.ts";
import type { AppContext, GameEdit } from "../services/index.ts";
import type { Handlers } from "./router.ts";

const addCategoryNotice = async (ctx: AppContext, rawName: string, actorId: string) =>
  `Added the category ${text((await addCategory(ctx, rawName, actorId)).name)}.`;

async function renameCategoryNotice(
  ctx: AppContext,
  categoryId: number,
  rawName: string,
  actorId: string,
): Promise<string> {
  const { previousName, name, changed } = await renameCategory(ctx, categoryId, rawName, actorId);
  return changed ? `Renamed ${text(previousName)} to ${text(name)}.` : MESSAGES.nothingChanged;
}

async function moveCategoryNotice(
  ctx: AppContext,
  categoryId: number,
  dir: MoveDirection,
  actorId: string,
): Promise<string> {
  const category = await moveCategory(ctx, categoryId, dir, actorId);
  return `Moved ${text(category.name)} ${dir}.`;
}

const addGameNotice = async (ctx: AppContext, input: Parameters<typeof addGame>[1]) =>
  `Added ${text((await addGame(ctx, input)).name)}.`;

async function editGameNotice(
  ctx: AppContext,
  gameId: number,
  patch: GameEdit,
  actorId: string,
): Promise<string> {
  const { game, changed } = await editGame(ctx, gameId, patch, actorId);
  return changed ? `Saved changes to ${text(game.name)}.` : MESSAGES.nothingChanged;
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
    await noticePrivately(interaction, () =>
      addGameNotice(ctx, {
        name: interaction.fields.getTextInputValue(FIELD.name),
        categoryId: modalCategory(interaction),
        aliases: interaction.fields.getTextInputValue(FIELD.aliases),
        actorId: interaction.user.id,
      }),
    );
  }),
  "game-edit-modal": modal(async (ctx, interaction) => {
    const { gameId } = idOf(interaction, "game-edit-modal");
    const { fields } = interaction;
    await noticePrivately(interaction, () =>
      editGameNotice(
        ctx,
        gameId,
        {
          name: fields.getTextInputValue(FIELD.name),
          categoryId: modalCategory(interaction),
          // Aliases are left out of the modal when they are too long to prefill.
          aliases: fields.fields.has(FIELD.aliases)
            ? fields.getTextInputValue(FIELD.aliases)
            : undefined,
        },
        interaction.user.id,
      ),
    );
  }),
  "confirm-remove": button(async (ctx, interaction) => {
    const id = idOf(interaction, "confirm-remove");
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
    const picked = choicesFromBits(idOf(interaction, "uninstall-confirm").choices);
    // The report will carry the only copy of the backup: from now on nothing may delete it.
    await deferAndKeep(interaction);
    await applyUninstall(
      ctx,
      interaction.user.id,
      picked,
      enclosingChannelId(interaction),
      async (result) => {
        await interaction.editReply(forEdit(uninstallReportView(result, picked)));
      },
    );
    // Last, once the report and backup have reached the admin.
    if (picked.has("leave")) await leaveServer(ctx);
  }),

  "category-add": button(async (_ctx, interaction) => {
    await interaction.showModal(categoryModal());
  }),
  "category-rename": button(async (ctx, interaction) => {
    const { categoryId } = idOf(interaction, "category-rename");
    await interaction.showModal(categoryModal(await requireCategory(ctx, categoryId)));
  }),
  "category-add-modal": modal(async (ctx, interaction) => {
    await answerCategoryModal(ctx, interaction, () =>
      addCategoryNotice(ctx, interaction.fields.getTextInputValue(FIELD.name), interaction.user.id),
    );
  }),
  "category-rename-modal": modal(async (ctx, interaction) => {
    const { categoryId } = idOf(interaction, "category-rename-modal");
    await answerCategoryModal(ctx, interaction, () =>
      renameCategoryNotice(
        ctx,
        categoryId,
        interaction.fields.getTextInputValue(FIELD.name),
        interaction.user.id,
      ),
    );
  }),
  "category-move": button(async (ctx, interaction) => {
    const id = idOf(interaction, "category-move");
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
    await noticePrivately(interaction, () =>
      addGameNotice(ctx, {
        name: interaction.options.getString("name", true),
        categoryId,
        aliases: interaction.options.getString("aliases") ?? "",
        actorId: interaction.user.id,
      }),
    );
  }),
  "gameadmin-edit": chatInput(async (ctx, interaction) => {
    const { options } = interaction;
    const name = options.getString("name");
    const category = options.getString("category");
    const aliases = options.getString("aliases");
    if (name === null && category === null && aliases === null) {
      throw new UserFacingError("Nothing to change.");
    }
    const gameId = parseGameId(options.getString("game", true));
    const patch: GameEdit = {
      name: name ?? undefined,
      categoryId: category === null ? undefined : parseCategoryId(category),
      aliases: aliases ?? undefined,
    };
    await noticePrivately(interaction, () =>
      editGameNotice(ctx, gameId, patch, interaction.user.id),
    );
  }),
  "gameadmin-remove": chatInput(async (ctx, interaction) => {
    const game = await resolvePickedGame(ctx, interaction.options.getString("game", true));
    await showPrivately(interaction, confirmRemove(ctx, game));
  }),

  "gameadmin-category-add": chatInput(async (ctx, interaction) => {
    await noticePrivately(interaction, () =>
      addCategoryNotice(ctx, interaction.options.getString("name", true), interaction.user.id),
    );
  }),
  "gameadmin-category-rename": chatInput(async (ctx, interaction) => {
    const categoryId = parseCategoryId(interaction.options.getString("category", true));
    await noticePrivately(interaction, () =>
      renameCategoryNotice(
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
      moveCategoryNotice(ctx, categoryId, direction, interaction.user.id),
    );
  }),

  "autocomplete-gameadmin": autocomplete(async (ctx, interaction) => {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "game") {
      const matches = await autocompleteGames(ctx, interaction.user.id, focused.value, "any");
      await interaction.respond(choices(matches));
    } else if (focused.name === "category") {
      const categories = await ctx.repos.categories.list();
      await interaction.respond(choices(rankCategories(focused.value, categories)));
    } else {
      await interaction.respond([]);
    }
  }),
};
