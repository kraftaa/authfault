import assert from "node:assert/strict";
import { instrumentAuthorizer } from "../../src/index.js";
import { authfaultTest as test } from "../../src/node-test.js";

const authorize = instrumentAuthorizer({
  id: "unstable.control",
  authorize: async () => true
});

test("isolated control must pass", async () => {
  const allowed = await authorize();

  // Models a test that passes in the complete suite but depends on shared setup
  // and fails when selected by itself.
  if (process.env.AUTHFAULT_SELECTED_TESTS && !process.env.AUTHFAULT_MUTATION) {
    throw new Error("shared setup was not available");
  }

  assert.equal(allowed, true);
});
