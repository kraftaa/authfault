import assert from "node:assert/strict";
import { instrumentAuthorizer } from "authfault";
import { authfaultTest as test } from "authfault/node-test";

const authorize = instrumentAuthorizer({
  id: "batch.item-read",
  authorize: async () => true
});

test("only checks the first decision in a three-item batch", async () => {
  const decisions = await Promise.all([
    authorize("first"),
    authorize("second"),
    authorize("third")
  ]);

  // Deliberately weak coverage: later item decisions are ignored.
  assert.equal(decisions[0], true);
});
