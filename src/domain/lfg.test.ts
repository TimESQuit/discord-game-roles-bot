import { expect, test } from "vitest";

import { toggleResponse } from "./lfg.ts";

test("toggle", () => {
  expect(toggleResponse(null, "in")).toBe("in");
  expect(toggleResponse("in", "in")).toBeNull();
  expect(toggleResponse("in", "maybe")).toBe("maybe");
  expect(toggleResponse("maybe", "in")).toBe("in");
  expect(toggleResponse("maybe", "maybe")).toBeNull();
  expect(toggleResponse(null, "maybe")).toBe("maybe");
});
