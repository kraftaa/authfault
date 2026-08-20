import assert from "node:assert/strict";
import { instrumentAuthorizer } from "authfault";
import { authfaultTest as test } from "authfault/node-test";

const authorize = instrumentAuthorizer({
  id: "reviewed.ignored-check",
  authorize: async () => true
});

test("calls authorization but deliberately ignores its result", async () => {
  await authorize();
  assert.equal("operation completed", "operation completed");
});
