import {
  authfaultOperation,
  decisionCodecs,
  environment,
  instrumentAuthorizer,
  instrumentOpenFgaClient,
  type DecisionCodec
} from "authfault";
import { authfaultTest as nodeTest } from "authfault/node-test";
import { authfaultTest as vitestTest } from "authfault/vitest";

const booleanAuthorizer = instrumentAuthorizer({
  id: "typed.boolean",
  authorize: async (owner: string, actor: string) => owner === actor
});
const booleanResult: Promise<boolean> = booleanAuthorizer("alice", "alice");

const objectAuthorizer = instrumentAuthorizer({
  id: "typed.object",
  authorize: (actor: string) => ({ allowed: true, actor })
});
const objectResult: Promise<{ allowed: boolean; actor: string }> =
  objectAuthorizer("alice");

const cedarAuthorizer = instrumentAuthorizer({
  id: "typed.cedar",
  authorize: async (request: { principal: { type: string; id: string } }) => ({
    type: "deny" as const
  }),
  decisionCodec: decisionCodecs.cedar
});
void cedarAuthorizer({ principal: { type: "User", id: "alice" } });

const avpAuthorizer = instrumentAuthorizer({
  id: "typed.avp",
  authorize: async () => ({
    decision: "ALLOW" as const,
    determiningPolicies: [{ policyId: "permit-1" }],
    errors: [],
    $metadata: { requestId: "request-1" }
  }),
  decisionCodec: decisionCodecs.verifiedPermissions
});
void avpAuthorizer();

type CustomResult = { outcome: "permit" | "forbid"; reason: string };
const customCodec: DecisionCodec<CustomResult> = {
  read: result => result.outcome === "permit",
  write: (result, allowed) => ({
    ...result,
    outcome: allowed ? "permit" : "forbid"
  })
};
const customAuthorizer = instrumentAuthorizer({
  id: "typed.custom",
  authorize: (): CustomResult => ({ outcome: "permit", reason: "owner" }),
  decisionCodec: customCodec
});
void customAuthorizer();

class ForbiddenError extends Error {}
const guard = instrumentAuthorizer({
  id: "typed.guard",
  authorize: async (allowed: boolean) => {
    if (!allowed) throw new ForbiddenError();
  },
  denialErrors: {
    isDenied: error => error instanceof ForbiddenError,
    createDenied: () => new ForbiddenError()
  }
});
const guardResult: Promise<void> = guard(true);

const operationResult: Promise<number> = authfaultOperation(
  "typed.operation",
  async () => 42
);

class TypedOpenFgaClient {
  check(request: { user: string; relation: string; object: string }) {
    return Promise.resolve({ allowed: true, requestId: request.object });
  }

  stores() {
    return Promise.resolve(["store-1"]);
  }
}
const openFgaClient: TypedOpenFgaClient = instrumentOpenFgaClient({
  client: new TypedOpenFgaClient(),
  id: request => `openfga.document.${request.relation}`
});
const openFgaResult: Promise<{ allowed: boolean; requestId: string }> =
  openFgaClient.check({
    user: "user:alice",
    relation: "viewer",
    object: "document:roadmap"
  });

nodeTest("typed node test", async context => {
  context.diagnostic(environment.mutation);
});
vitestTest("typed Vitest test", { timeout: 1_000 }, ({ expect }) => {
  expect(true).toBe(true);
});

void booleanResult;
void objectResult;
void guardResult;
void operationResult;
void openFgaResult;

// @ts-expect-error Structured decisions require a decision codec.
instrumentAuthorizer({
  id: "typed.invalid-structured",
  authorize: async () => ({ decision: "ALLOW" as const })
});

instrumentAuthorizer({
  id: "typed.invalid-guard-codec",
  authorize: async () => undefined,
  // @ts-expect-error Guard classification and decision codecs are mutually exclusive.
  denialErrors: {
    isDenied: () => false,
    createDenied: () => new Error("denied")
  },
  decisionCodec: customCodec
});
