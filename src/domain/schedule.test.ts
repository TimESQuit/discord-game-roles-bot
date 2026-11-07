import { expect, test } from "vitest";
import { msUntilNextRun, selectExpiredBackups } from "./schedule.ts";

test("next run later today / tomorrow / exactly now → tomorrow", () => {
  expect(msUntilNextRun(new Date("2026-11-07T03:00:00Z"), 4)).toBe(3_600_000);
  expect(msUntilNextRun(new Date("2026-11-07T05:00:00Z"), 4)).toBe(23 * 3_600_000);
  expect(msUntilNextRun(new Date("2026-11-07T04:00:00Z"), 4)).toBe(24 * 3_600_000);
});

test("expired = older than 30 days, with attachment", () => {
  const now = new Date("2026-11-07T04:00:00Z");
  const msgs = [
    { id: "old", createdAt: new Date("2026-10-07T03:59:59Z"), hasAttachment: true },
    { id: "edge", createdAt: new Date("2026-10-08T04:00:00Z"), hasAttachment: true },
    { id: "text", createdAt: new Date("2026-01-01T00:00:00Z"), hasAttachment: false },
  ];
  expect(selectExpiredBackups(msgs, now, 30)).toEqual(["old"]);
});
