import assert from "node:assert/strict";
import { test } from "node:test";
import { instrumentAuthorizer } from "../../src/index.js";

const authorize = instrumentAuthorizer({
  id: "unattributed.read",
  authorize: async () => true
});

test("plain node tests remain supported", async () => {
  assert.equal(await authorize(), true);
});
