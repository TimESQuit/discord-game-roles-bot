import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { expect, test } from "vitest";

import { choicesToBits, parseId } from "../domain/index.ts";
import { customIdButtons, defined, findComponents, flagBits } from "../testing/index.ts";
import { uninstallPreviewView, uninstallReportView } from "./uninstall.ts";

import type { UninstallOption, UninstallSummary } from "../domain/index.ts";

const summary = (here: UninstallSummary["here"] = null): UninstallSummary => ({
  gameRoles: 2,
  members: 3,
  memberChannels: 2,
  adminChannels: 3,
  here,
});

const confirmOf = (keep: UninstallOption[], here: UninstallSummary["here"] = null) =>
  defined(
    customIdButtons(uninstallPreviewView(summary(here), new Set(keep))).find(
      (b) => parseId(b.custom_id)?.kind === "uninstall-confirm",
    ),
  );

test("the Uninstall button is red, private, and carries the current choices", () => {
  const keep: UninstallOption[] = ["keepRoles", "leave"];
  const view = uninstallPreviewView(summary(), new Set(keep));
  const confirm = confirmOf(keep);
  expect(confirm.style).toBe(ButtonStyle.Danger);
  expect(parseId(confirm.custom_id)).toEqual({
    kind: "uninstall-confirm",
    choices: choicesToBits(new Set(keep)),
  });
  expect(flagBits(view) & MessageFlags.Ephemeral).toBeTruthy();
});

test("the choices menu shows the current choices as ticked and allows none", () => {
  const view = uninstallPreviewView(summary(), new Set(["keepAdminChannels"]));
  const menu = defined(findComponents(view, ComponentType.StringSelect)[0]);
  expect(parseId(menu.custom_id)?.kind).toBe("uninstall-options");
  expect(menu.min_values).toBe(0);
  expect(menu.options.filter((o) => o.default).map((o) => o.value)).toEqual(["keepAdminChannels"]);
});

test("Uninstall is disabled while it would delete the channel the admin is in", () => {
  expect(confirmOf([], "admin").disabled).toBe(true);
  expect(confirmOf(["keepAdminChannels"], "admin").disabled).toBeFalsy();
  expect(confirmOf([], "member").disabled).toBe(true);
  expect(confirmOf(["keepMemberChannels"], "member").disabled).toBeFalsy();
  expect(confirmOf([], null).disabled).toBeFalsy();
});

test("the report attaches the backup", () => {
  const attachment = Buffer.from("db");
  const view = uninstallReportView(
    { deletedRoles: 3, deletedChannels: 6, backup: { name: "backup.sqlite", attachment } },
    new Set(),
  );
  expect(view.files).toEqual([{ attachment, name: "backup.sqlite" }]);
});
