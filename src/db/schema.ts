import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
  position: integer("position").notNull(),
});

export const games = sqliteTable("games", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  roleId: text("role_id").notNull().unique(),
  addedBy: text("added_by").notNull(),
  addedAt: text("added_at").notNull(),
});

export const gameAliases = sqliteTable(
  "game_aliases",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.alias] })],
);

export const setup = sqliteTable("setup", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const suggestions = sqliteTable(
  "suggestions",
  {
    id: integer("id").primaryKey(),
    suggesterId: text("suggester_id").notNull(),
    name: text("name").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    reviewerId: text("reviewer_id"),
    rejectionReason: text("rejection_reason"),
    decidedAt: text("decided_at"),
    createdAt: text("created_at").notNull(),
    reviewMessageId: text("review_message_id"),
    gameId: integer("game_id").references(() => games.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "suggestions_status_check",
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
    index("suggestions_by_user").on(t.suggesterId, t.status),
  ],
);

export const lfgPosts = sqliteTable("lfg_posts", {
  messageId: text("message_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  gameId: integer("game_id").references(() => games.id, { onDelete: "set null" }),
  gameName: text("game_name").notNull(),
  authorId: text("author_id").notNull(),
  when: text("when"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const lfgResponses = sqliteTable(
  "lfg_responses",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => lfgPosts.messageId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    respondedAt: text("responded_at").notNull(),
  },
  (t) => [
    check("lfg_responses_kind_check", sql`${t.kind} IN ('in', 'maybe')`),
    primaryKey({ columns: [t.messageId, t.userId] }),
  ],
);
