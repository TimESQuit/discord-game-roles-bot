import { describe, expect, test } from "vitest";

import { planSetup } from "./setup-plan.ts";

const ALL = {
  templateRoleId: "1",
  panelChannelId: "2",
  panelMessageId: "3",
  newsChannelId: "4",
  adminCategoryId: "5",
  adminChannelId: "6",
  logChannelId: "7",
  backupsChannelId: "8",
};

describe("planSetup", () => {
  test("fresh server: everything to create, in dependency order", () => {
    expect(
      planSetup({ recorded: {}, exists: () => false, categoryCount: 0, panelMessageExists: false })
        .create,
    ).toEqual([
      "templateRole",
      "panelChannel",
      "newsChannel",
      "adminCategory",
      "adminChannel",
      "logChannel",
      "backupsChannel",
      "categories",
      "panelMessage",
    ]);
  });

  test("everything recorded and present: nothing to create", () => {
    const plan = planSetup({
      recorded: ALL,
      exists: () => true,
      categoryCount: 3,
      panelMessageExists: true,
    });
    expect(plan.create).toEqual([]);
    expect(plan.fine).toHaveLength(9);
  });

  test("recorded but deleted is recreated; existing is fine", () => {
    const plan = planSetup({
      recorded: ALL,
      exists: (key) => key !== "newsChannelId" && key !== "templateRoleId",
      categoryCount: 3,
      panelMessageExists: true,
    });
    expect(plan.create).toEqual(["templateRole", "newsChannel"]);
    expect(plan.fine).toContain("panelChannel");
    expect(plan.fine).not.toContain("newsChannel");
  });

  test("deleted admin category: only the category is recreated", () => {
    const plan = planSetup({
      recorded: ALL,
      exists: (key) => key !== "adminCategoryId",
      categoryCount: 3,
      panelMessageExists: true,
    });
    expect(plan.create).toEqual(["adminCategory"]);
    expect(plan.fine).toContain("adminChannel");
  });

  test("a recreated panel channel forces a new panel message", () => {
    const plan = planSetup({
      recorded: ALL,
      exists: (key) => key !== "panelChannelId",
      categoryCount: 3,
      panelMessageExists: true,
    });
    expect(plan.create).toEqual(["panelChannel", "panelMessage"]);
  });

  test("categories are only created when there are none", () => {
    const base = { recorded: ALL, exists: () => true, panelMessageExists: true };
    expect(planSetup({ ...base, categoryCount: 0 }).create).toEqual(["categories"]);
    expect(planSetup({ ...base, categoryCount: 1 }).create).toEqual([]);
  });
});
