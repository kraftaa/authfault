import assert from "node:assert/strict";
import { authfaultOperation, instrumentAuthorizer } from "../../src/index.js";
import { authfaultTest as test } from "../../src/node-test.js";

const authorize = instrumentAuthorizer({
  id: "shared.document-viewer",
  authorize: async allowed => allowed
});

test("first operation allows access", async () => {
  await authfaultOperation("document.preview", async () => {
    assert.equal(await authorize(true), true);
  });
});

test("second operation denies access", async () => {
  await authfaultOperation("document.download", async () => {
    assert.equal(await authorize(false), false);
  });
});
