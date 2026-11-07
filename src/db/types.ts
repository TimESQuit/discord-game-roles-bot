export type Category = { id: number; name: string; position: number };

export type Game = {
  id: number;
  name: string;
  categoryId: number;
  roleId: string;
  aliases: string[];
  addedBy: string;
  addedAt: string;
};

export type SetupKey =
  | "templateRoleId"
  | "panelChannelId"
  | "panelMessageId"
  | "newsChannelId"
  | "adminCategoryId"
  | "adminChannelId"
  | "logChannelId"
  | "backupsChannelId";
