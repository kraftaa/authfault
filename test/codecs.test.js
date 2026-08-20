import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decisionCodecs,
  environment,
  instrumentAuthorizer
} from "../src/index.js";

test("preserves an unmutated Cedar result by identity", async () => {
  const original = {
    type: "allow",
    authorizerInfo: {
      principalUid: { type: "User", id: "alice" },
      determiningPolicies: ["policy-1"]
    }
  };
  const authorize = instrumentAuthorizer({
    id: "cedar.read",
    authorize: async () => original,
    decisionCodec: decisionCodecs.cedar
  });

  assert.equal(await authorize({ principal: { type: "User", id: "alice" } }), original);
});

test("mutates Cedar allow and deny results into valid opposite shapes", async () => {
  const principal = { type: "User", id: "alice" };
  const allow = instrumentAuthorizer({
    id: "cedar.allow",
    authorize: async () => ({
      type: "allow",
      authorizerInfo: { principalUid: principal, determiningPolicies: ["permit-1"] }
    }),
    decisionCodec: decisionCodecs.cedar
  });
  const deny = instrumentAuthorizer({
    id: "cedar.deny",
    authorize: async () => ({ type: "deny" }),
    decisionCodec: decisionCodecs.cedar
  });

  await withMutation({ id: "cedar.allow", decision: "deny" }, async () => {
    assert.deepEqual(await allow({ principal }), { type: "deny" });
  });
  await withMutation({ id: "cedar.deny", decision: "allow" }, async () => {
    assert.deepEqual(await deny({ principal }), {
      type: "allow",
      authorizerInfo: { principalUid: principal, determiningPolicies: [] }
    });
  });
});

test("never reclassifies a Cedar engine error as a denial", async () => {
  const engineError = { type: "error", message: "schema mismatch" };
  const authorize = instrumentAuthorizer({
    id: "cedar.error",
    authorize: async () => engineError,
    decisionCodec: decisionCodecs.cedar
  });

  await withMutation({ id: "cedar.error", decision: "allow" }, async () => {
    assert.equal(await authorize({}), engineError);
  });
});

test("mutates Verified Permissions decisions without stale policy IDs", async () => {
  const metadata = { requestId: "request-1" };
  const errors = [{ errorDescription: "an unrelated policy failed" }];
  const authorize = instrumentAuthorizer({
    id: "avp.read",
    authorize: async () => ({
      $metadata: metadata,
      decision: "DENY",
      determiningPolicies: [{ policyId: "forbid-1" }],
      errors
    }),
    decisionCodec: decisionCodecs.verifiedPermissions
  });

  await withMutation({ id: "avp.read", decision: "allow" }, async () => {
    assert.deepEqual(await authorize(), {
      $metadata: metadata,
      decision: "ALLOW",
      determiningPolicies: [],
      errors
    });
  });
});

test("supports custom structured decision codecs", async () => {
  const authorize = instrumentAuthorizer({
    id: "custom.read",
    authorize: async () => ({ outcome: "yes", evidence: "owner" }),
    decisionCodec: {
      read: (result) => result.outcome === "yes",
      write: (result, allowed, context) => ({
        ...result,
        outcome: allowed ? "yes" : "no",
        mutatedPoint: context.id
      })
    }
  });

  await withMutation({ id: "custom.read", decision: "deny" }, async () => {
    assert.deepEqual(await authorize(), {
      outcome: "no",
      evidence: "owner",
      mutatedPoint: "custom.read"
    });
  });
});

test("passes through custom non-decision results unchanged", async () => {
  const pending = { outcome: "pending", retryAfter: 10 };
  const authorize = instrumentAuthorizer({
    id: "custom.pending",
    authorize: async () => pending,
    decisionCodec: {
      read: () => undefined,
      write: () => {
        throw new Error("write must not be called for a non-decision");
      }
    }
  });

  await withMutation({ id: "custom.pending", decision: "allow" }, async () => {
    assert.equal(await authorize(), pending);
  });
});

test("rejects ambiguous or invalid codec configuration", () => {
  assert.throws(
    () => instrumentAuthorizer({
      id: "invalid.codec",
      authorize: async () => true,
      decisionCodec: { read: () => true }
    }),
    /decisionCodec must provide/
  );

  assert.throws(
    () => instrumentAuthorizer({
      id: "invalid.guard-codec",
      authorize: async () => undefined,
      denialErrors: {
        isDenied: () => false,
        createDenied: () => new Error("denied")
      },
      decisionCodec: {
        read: () => true,
        write: (_result, allowed) => allowed
      }
    }),
    /cannot combine denialErrors with decisionCodec/
  );
});

async function withMutation(mutation, callback) {
  const previous = process.env[environment.mutation];
  process.env[environment.mutation] = JSON.stringify(mutation);
  try {
    await callback();
  } finally {
    if (previous === undefined) delete process.env[environment.mutation];
    else process.env[environment.mutation] = previous;
  }
}
