import { describe, expect } from "bun:test";
import { instrumentAuthorizer } from "authfault";
import { authfaultTest as test } from "authfault/bun";

const authorize = instrumentAuthorizer({
  id: "bun.document-read",
  authorize: async () => true
});

describe("document access", () => {
  test("allows the owner", async () => {
    expect(await authorize()).toBe(true);
  });

  test("supports a numeric timeout", () => {
    expect(true).toBe(true);
  }, 1_000);
});
