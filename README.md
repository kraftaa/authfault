# authfault

`authfault` injects faults into authorization decisions during tests. Its
question is deliberately narrow:

> Would this test suite fail if an observed authorization decision were wrong?

It does **not** prove that an application is secure, discover missing checks, or
replace API security testing.

In plain language: **AuthFault checks whether your application actually obeys
its authorization decisions.** It deliberately changes an observed `allow` to
`deny` (and `deny` to `allow`) while testing. If the tests still pass, that
decision is not protected by the current test suite.

## Quick start

> **Pre-release:** `authfault` is not published to npm yet. The commands below
> describe the intended release workflow; for local evaluation, install this
> checkout by path with `npm install --save-dev /path/to/authfault`.

Install AuthFault in a Node.js project:

```sh
npm install --save-dev authfault
```

Ask for a setup guide tailored to the detected test runner:

```sh
npx authfault init
```

After wrapping the authorizer as shown below, run:

```sh
npx authfault
```

With no arguments, AuthFault runs the project's existing `npm test` command.
Use `npx authfault -- <command>` only when a different test command is needed.

## Try the spike

No dependencies are required beyond Node.js 20 or newer.

```sh
npm test
npm run demo
```

The demo contains:

- a secure delete operation with positive and negative tests;
- an authorization decision that is calculated but ignored;
- a correctly enforced operation with no negative decision coverage; and
- a layered route/service check that demonstrates a possible compensating
  control.

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
- Missing authorization calls cannot be discovered.
- Logical enforcement points require explicit stable IDs.
- Reset commands are local executables with an argument array; shell syntax is
  intentionally not interpreted.
- Request contents are not written to traces, avoiding accidental secret or PII
  collection.
