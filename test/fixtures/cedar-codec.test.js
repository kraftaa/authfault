import assert from "node:assert/strict";
import { decisionCodecs, instrumentAuthorizer } from "authfault";
import { authfaultTest as test } from "authfault/node-test";

const authorize = instrumentAuthorizer({
  id: "cedar.document-read",
  authorize: async ({ principal, owner }) =>
    principal.id === owner
      ? {
          type: "allow",
          authorizerInfo: {
            principalUid: principal,
            determiningPolicies: ["owner-can-read"]
          }
        }
      : { type: "deny" },
  decisionCodec: decisionCodecs.cedar
});

test("Cedar allows the owner", async () => {
  const result = await authorize({
    principal: { type: "User", id: "alice" },
    owner: "alice"
  });
  assert.equal(result.type, "allow");
});

test("Cedar denies another user", async () => {
  const result = await authorize({
    principal: { type: "User", id: "mallory" },
    owner: "alice"
  });
  assert.equal(result.type, "deny");
});
