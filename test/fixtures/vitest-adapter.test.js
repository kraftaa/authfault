import { describe, expect } from "vitest";
import { instrumentAuthorizer } from "authfault";
import { authfaultTest as test } from "authfault/vitest";

const authorize = instrumentAuthorizer({
  id: "vitest.document-read",
  authorize: async () => true
});

describe("document access", () => {
  test("allows the owner", async ({ expect: localExpect }) => {
    localExpect(await authorize()).toBe(true);
  });

  test("supports Vitest options", { timeout: 1_000 }, () => {
    expect(true).toBe(true);
  });

  test("supports a numeric timeout", () => {
    expect(true).toBe(true);
  }, 1_000);
});
