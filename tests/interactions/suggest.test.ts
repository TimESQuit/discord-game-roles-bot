import { expect, test } from "vitest";
import { DRAFT_TTL_MS, draftStore } from "../../src/interactions/suggest.ts";

const draft = { name: "Valheim", categoryId: 1, note: null };

test("a draft lives 15 minutes, one per person, and writes sweep expired ones", () => {
  draftStore.entries.clear();
  draftStore.put("100000000000000001", draft, 0);
  expect(draftStore.get("100000000000000001", DRAFT_TTL_MS - 1)).toEqual(draft);
  expect(draftStore.get("100000000000000001", DRAFT_TTL_MS)).toBeUndefined();
  draftStore.put("100000000000000002", { ...draft, name: "Other" }, DRAFT_TTL_MS);
  expect(draftStore.entries.has("100000000000000001")).toBe(false);
  draftStore.put("100000000000000002", draft, DRAFT_TTL_MS);
  expect(draftStore.entries.size).toBe(1);
  expect(draftStore.get("100000000000000002", DRAFT_TTL_MS)?.name).toBe("Valheim");
});
