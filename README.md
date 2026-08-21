# authfault

`authfault` mutation-tests the authorization decisions your existing tests
exercise. Its question is deliberately narrow:

> Would this test suite fail if an observed authorization decision were wrong?

It does **not** prove that an application is secure, discover missing checks, or
replace API security testing.

In plain language: **AuthFault tests whether the authorization controls you
already have are actually enforced and tested.** It deliberately changes an
observed `allow` to `deny` (and `deny` to `allow`) while testing. If the tests
still pass, that decision is not protected by the current test suite.

> [!IMPORTANT]
> AuthFault can only test authorization decisions that pass through an
> instrumented boundary. It cannot discover an operation that never calls an
> authorizer—the absence of a check produces no decision to mutate.

## Quick start

For a guided first integration, see **[Your first AuthFault result in five
minutes](https://github.com/kraftaa/authfault/blob/main/docs/QUICKSTART.md)**.

> **Pre-release:** `authfault` is not published to npm yet. The commands below
> describe the intended release workflow; for local evaluation, install this
> checkout by path with `npm install --save-dev /path/to/authfault`.

Install AuthFault in a Node.js project:

```sh
npm install --save-dev authfault
```

Print a setup guide tailored to the detected test runner or OpenFGA SDK:

```sh
npx authfault init
```

`init` only prints guidance; it does not edit the application. Instrument one
central authorization boundary using either of the patterns below. This is the
required integration step.

After wrapping the authorizer as shown below, verify that the tests observe it:

```sh
npx authfault doctor
```

Then inject the authorization faults:

```sh
npx authfault
```

With no arguments, AuthFault runs the project's existing `npm test` command.
Use `npx authfault -- <command>` only when a different test command is needed.

`doctor` runs the existing tests without injecting faults. It lists observed
points, allow/deny coverage, attribution quality, and evidence that one point ID
may span several logical operations. To print the complete inventory with test
names, run:

```sh
npx authfault list-points
```

Both inspection commands accept a different test command after `--`.

## Try the spike

No dependencies are required beyond Node.js 20 or newer.

```sh
npm test
npm run demo
npm run demo:express
npm run demo:openfga
```

The demo contains:

- a secure delete operation with positive and negative tests;
- an authorization decision that is calculated but ignored;
- a correctly enforced operation with no negative decision coverage; and
- a layered route/service check that demonstrates a possible compensating
  control.

`npm run demo:express` exercises the same idea through real HTTP requests. Its
delete route correctly enforces tenant ownership; its archive route contains a
deliberate integration bug that calculates an authorization decision and then
ignores it. The example keeps Express as a development-only dependency—AuthFault
itself still has zero runtime dependencies.

`npm run demo:openfga` exercises the adapter through the official OpenFGA
JavaScript SDK. It replaces only the network transport with a deterministic
response, so no OpenFGA server is required.

## Instrument an authorizer

```js
import { instrumentAuthorizer } from "authfault";

const authorize = instrumentAuthorizer({
  id: "project.delete",
  authorize: async ({ actor, project }) =>
    actor.role === "admin" || actor.tenantId === project.tenantId
});
```

The function may return a boolean or an object containing an `allowed` boolean.

### OpenFGA: wrap the client once

If the application reuses one OpenFGA client, wrap it where that client is
created. Existing `client.check(...)` call sites do not need to change:

```js
import { OpenFgaClient } from "@openfga/sdk";
import { instrumentOpenFgaClient } from "authfault";

export const fga = instrumentOpenFgaClient({
  client: new OpenFgaClient({
    apiUrl: process.env.FGA_API_URL,
    storeId: process.env.FGA_STORE_ID,
    authorizationModelId: process.env.FGA_MODEL_ID
  })
});

// Unchanged elsewhere in the application:
const result = await fga.check({
  user: "user:anne",
  relation: "viewer",
  object: "document:roadmap"
});
```

By default, that request is grouped under the stable point ID
`openfga.document.viewer`. User and object identifiers are not included in the
point ID or trace. To align IDs with domain operations, pass an `id` string or
resolver:

```js
const fga = instrumentOpenFgaClient({
  client,
  id: request => `permissions.${request.object.split(":")[0]}.${request.relation}`
});
```

Only `check` is instrumented. Other client properties and methods are forwarded
to the original client. AuthFault does not add `@openfga/sdk` as a dependency.

### Cedar and structured decisions

Use a decision codec when the authorizer returns a structured result instead of
a boolean. The built-in Cedar codec supports results from
`@cedar-policy/cedar-authorization`:

```js
import { decisionCodecs, instrumentAuthorizer } from "authfault";

const authorize = instrumentAuthorizer({
  id: "project.delete",
  authorize: (request, entities) => cedar.isAuthorized(request, entities),
  decisionCodec: decisionCodecs.cedar
});
```

`allow` and `deny` results are traced and mutated. Cedar `error` results pass
through unchanged and are not counted as denials. When injecting an allow, the
codec constructs valid `authorizerInfo` from `request.principal` and uses an
empty synthetic determining-policy list.

Amazon Verified Permissions responses are also supported:

```js
const authorize = instrumentAuthorizer({
  id: "project.delete",
  authorize: input => avpClient.send(new IsAuthorizedCommand(input)),
  decisionCodec: decisionCodecs.verifiedPermissions
});
```

The codec changes `decision` between `ALLOW` and `DENY`, retains response
metadata and evaluation errors, and clears `determiningPolicies` so policy IDs
from the original opposite decision are not misrepresented.

Custom formats use the same interface:

```js
const decisionCodec = {
  read(result, context) {
    return result.outcome === "permit";
  },
  write(result, allowed, context) {
    return { ...result, outcome: allowed ? "permit" : "forbid" };
  }
};
```

`read` must return `true`, `false`, or `undefined`; `undefined` means the result
is not an authorization decision and must pass through unchanged. `context`
contains the stable point `id` and the original authorizer `args`.

Run the application's existing `npm test` command through the runner:

```sh
npx authfault
```

Or provide a different test command explicitly:

```sh
authfault -- node --test test/*.test.js
```

For `node:test`, use the attribution helper so mutation runs can skip unrelated
tests:

```js
import { authfaultTest as test } from "authfault/node-test";

test("another tenant cannot delete the project", async () => {
  // test body
});
```

Without a test adapter, decisions still work but mutation runs rerun the full
test command.

For Vitest 4.1 or newer, use the equivalent optional adapter:

```js
import { describe } from "vitest";
import { authfaultTest as test } from "authfault/vitest";

describe("project deletion", () => {
  test("another tenant cannot delete the project", async ({ expect }) => {
    // test body
  });
});
```

Then run Vitest in non-watch mode through the runner:

```sh
authfault -- vitest run
```

The adapter supports normal callbacks, numeric timeouts, and Vitest test option
objects. Use the regular Vitest import for `describe`, hooks, and specialized
APIs such as `test.each`.

### Throw-on-deny guards

Guard functions are supported when denial errors are identified explicitly:

```js
const requirePermission = instrumentAuthorizer({
  id: "project.delete",
  authorize: realGuard,
  denialErrors: {
    isDenied: error => error instanceof ForbiddenError,
    createDenied: () => new ForbiddenError("injected denial")
  }
});
```

Explicit classification prevents network, timeout, and programming errors from
being mistaken for authorization denials.

### Correlate layered controls

Wrap one logical request or job with `authfaultOperation` when it can pass
through multiple authorization checks:

```js
import { authfaultOperation } from "authfault";

return authfaultOperation("project.delete", async () => {
  await checkAtRoute();
  return deleteInService();
});
```

If a forced allow survives and another instrumented point denies within the
same operation, the report labels it as a **possible compensating control**.
That correlation is useful evidence, but it is not proof that every path is
protected.

### Keep mutation runs isolated

The runner refuses to start when `NODE_ENV=production`. The
`--allow-production` override exists for unusual, intentionally isolated test
environments and should not be a normal CI setting.

For tests that mutate persistent state, provide an argv-safe reset command. It
runs before the baseline, each isolated control, and each mutation execution:

```sh
authfault \
  --reset-command '["npm","run","test:reset"]' \
  -- node --test
```

Reset commands receive `AUTHFAULT_PHASE` (`baseline`, `control`, or `mutation`),
plus `AUTHFAULT_POINT_ID`, `AUTHFAULT_DECISION`, and `AUTHFAULT_OCCURRENCE` when
applicable. A failed or timed-out reset prevents the corresponding test
execution from being credited.

### Review survivors in CI

Use the plain-language failure option and GitHub reporter in GitHub Actions:

```yaml
- name: Test authorization enforcement
  run: npx authfault --fail-on-gap --reporter github
```

The reporter adds a job summary with protected faults, enforcement gaps, and
results needing review. `--fail-on-gap` is an alias for the original
`--fail-on-survivor` option; both remain supported.

Generate a review template for the current survivors:

```sh
authfault --write-baseline authfault-baseline.json -- node --test
```

Every generated entry starts incomplete. Add a concrete justification, an
accountable owner, and an expiration date:

```json
{
  "version": 1,
  "survivors": [
    {
      "id": "project.layered-route",
      "decision": "allow",
      "reason": "The service layer independently enforces tenant ownership",
      "owner": "security@example.com",
      "expires": "2026-11-01"
    }
  ]
}
```

Commit the reviewed file, then enforce it in CI:

```sh
authfault \
  --baseline authfault-baseline.json \
  --fail-on-survivor \
  -- node --test
```

The point ID and mutation direction form the stable identity; test names and
observation counts are deliberately excluded. Missing reasons, owners, invalid
dates, and expired reviews do not suppress `--fail-on-survivor`. An expiration
date remains valid through that UTC calendar date. The report distinguishes
new, incomplete or expired, and reviewed survivors, and warns about stale
entries that are no longer observed.

Regenerating with both `--baseline` and `--write-baseline` preserves review
metadata for survivors that still match. To prevent accidental metadata loss,
`--write-baseline` will not overwrite an existing file unless `--baseline` is
also supplied. Baselines are not written when a fault is flaky or inconclusive,
and baseline options cannot be combined with `--max-mutants`, because either
case would create an incomplete review artifact.

### TypeScript

All public imports include declarations: `authfault`, `authfault/node-test`,
and `authfault/vitest`. Types cover boolean and object decisions, guard-style
authorizers, structured codecs, operation scopes, and both test adapters. The
package does not require TypeScript at runtime.

## What the report means

- **PROTECTED (KILLED)**: changing the decision caused at least one test to fail.
- **ENFORCEMENT GAP (SURVIVED)**: the tests still passed after the decision was
  changed. Investigate; this is not automatically a vulnerability.
- **COULD NOT VERIFY (INCONCLUSIVE)**: the isolated control failed, timed out,
  or could not run.
- **UNSTABLE RESULT (FLAKY)**: confirmation runs disagreed about whether the
  mutation was caught.
- **MISSING COVERAGE**: the baseline tests did not observe an allow or deny outcome
  at that enforcement point.

A survivor is evidence that the test suite is insensitive to the injected
fault. It is not automatically a vulnerability: another control may be
providing deliberate defense in depth.

Mutation direction provides additional context:

| Injected change | What a survivor means |
| --- | --- |
| `allow` → `deny` | The tests did not detect a forced denial. The authorization result may not control the operation's behavior. |
| `deny` → `allow` | The tests did not detect a forced allow. Verify whether another control intentionally blocks access or a negative assertion is missing. |

These are investigation prompts, not severity ratings. AuthFault has no
ground-truth knowledge about the application's intended behavior.

Before injecting a fault, the runner executes the selected tests without a
mutation. Killed faults are repeated twice by default. Configure this with
`--confirm-kills`, and bound every subprocess with `--timeout`.

### Inspect individual calls

Point granularity is the default: every matching decision in the selected test
is changed together. Use occurrence granularity to create a separate mutant for
each observed call:

```sh
authfault --granularity occurrence -- node --test
```

Occurrences are numbered independently for each stable test ID and
authorization point. This exposes weak assertions in loops, batches, and
fallback chains where changing every call at once can produce an unrealistically
large fault. Occurrence baselines additionally include the test ID and
occurrence number because both are part of the mutant identity.

Occurrence mode assumes calls at a point happen in a deterministic order. A
real change in call order intentionally produces new and stale baseline entries;
flaky call order should be fixed before occurrence survivors are reviewed.
Decisions without a test adapter use one process-wide occurrence stream and are
therefore less stable than attributed decisions.

Attributed Node test IDs include the test file and the complete suite/test name,
for example:

```text
test/projects.test.js::project deletion > rejects another tenant
```

Trace collection uses one JSONL file per process, so parallel test workers do
not append to a shared file. Traces contain point IDs, decisions, test IDs, and
optional operation correlation IDs—not authorizer arguments or request bodies.

## Deliberate MVP constraints

- Targeted reruns currently require the `node:test` or Vitest attribution
  helper.
- Missing authorization calls cannot be discovered. An operation that never
  invokes an instrumented authorizer is invisible to AuthFault.
- Logical enforcement points require explicit stable IDs.
- Reset commands are local executables with an argument array; shell syntax is
  intentionally not interpreted.
- Request contents are not written to traces, avoiding accidental secret or PII
  collection.
