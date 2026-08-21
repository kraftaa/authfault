import assert from "node:assert/strict";
import { authfaultTest as test } from "../../src/node-test.js";
import { createOpenFgaClient, viewDocument } from "./app.js";

const storeId = "01H0H015178Y2V4CX10C2KGHF4";

function createClient() {
  const client = createOpenFgaClient({
    apiUrl: "http://127.0.0.1:8080",
    storeId
  });

  // Keep the example deterministic and offline while exercising the real
  // OpenFgaClient.check implementation and its request translation.
  client.api.check = async (actualStoreId, body) => {
    assert.equal(actualStoreId, storeId);
    return {
      allowed:
        body.tuple_key.user === "user:anne" &&
        body.tuple_key.object === "document:roadmap"
    };
  };
  return client;
}

test("the document owner can view the document", async () => {
  assert.equal(await viewDocument(createClient(), "anne", "roadmap"), 200);
});

test("another user cannot view the document", async () => {
  assert.equal(await viewDocument(createClient(), "bob", "roadmap"), 404);
});
