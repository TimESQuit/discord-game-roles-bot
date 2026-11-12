import { expect, test } from "vitest";

import { text } from "./text.ts";

test("a masked link shows as plain text, not a disguised link", () => {
  expect(text("[Claim here](https://evil.example/login)")).toBe(
    "\\[Claim here](https://evil.example/login)",
  );
});

test("headings and lists at the start of a line stay plain text", () => {
  expect(text("# FREE NITRO\n- one\n1. two")).toBe("\\# FREE NITRO\n\\- one\n1\\. two");
});

test("inline formatting and mentions are neutralised", () => {
  expect(text("**bold** @everyone")).toBe("\\*\\*bold\\*\\* @​everyone");
});
