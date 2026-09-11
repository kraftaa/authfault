# Your first AuthFault result in five minutes

AuthFault answers one question: **would your tests fail if an authorization
decision they already exercise were wrong?** It cannot discover a code path
that never calls an authorizer.

## 1. Install it

AuthFault is not on npm yet. During the pre-release, install a checkout by path:

```sh
npm install --save-dev /path/to/authfault
```

After the first npm release, the command becomes:

```sh
npm install --save-dev authfault
```

## 2. Instrument one shared boundary

For a function that returns a boolean or `{ allowed }`:

```js
import { instrumentAuthorizer } from "authfault";

export const authorize = instrumentAuthorizer({
  id: "project.delete",
  authorize: realAuthorize
});
```

For a shared OpenFGA client:

```js
import { OpenFgaClient } from "@openfga/sdk";
import { instrumentOpenFgaClient } from "authfault";

export const fga = instrumentOpenFgaClient({
  client: new OpenFgaClient(openFgaOptions),
  id: "project.delete"
});
```

Existing `fga.check(...)` calls stay unchanged. Use an ID for the application
operation when possible. A broad ID such as `openfga.document.viewer` can mix
unrelated routes that happen to use the same OpenFGA relation.

## 3. Check the integration

```sh
npx authfault doctor
```

The doctor runs the existing test command without mutations. It reports:

- which authorization points were observed;
- whether both allowed and denied decisions have test coverage;
- whether decisions can be attributed to individual tests; and
- whether one point ID appears to span multiple logical operations.

For the complete inventory, including attributed test names:

```sh
npx authfault list-points
```

## 4. Inject authorization faults

```sh
npx authfault
```

AuthFault runs `npm test` by default. To use another test command:

```sh
npx authfault -- node --test test/authorization.test.js
```

For Bun tests, replace the regular `test` import with AuthFault's adapter so
decisions can be attributed and unrelated tests can be skipped:

```ts
import { describe, expect } from "bun:test";
import { authfaultTest as test } from "authfault/bun";
```

Then run the existing Bun suite explicitly:

```sh
npx authfault -- bun test
```

## 5. Read the result carefully

- `PROTECTED`: the test failed when AuthFault changed the decision.
- `ENFORCEMENT GAP`: the test stayed green. Investigate whether the result is
  ignored or the assertion is too weak.
- `MISSING COVERAGE`: tests observed only one decision direction.
- `COULD NOT VERIFY` or `UNSTABLE RESULT`: AuthFault could not produce a stable
  experiment.

An enforcement gap is an investigation prompt, not proof of a vulnerability.

## Try the real OpenFGA SDK example

Inside the AuthFault checkout:

```sh
npm ci
npm run demo:openfga
```

The example constructs the official `OpenFgaClient`, wraps it once, and runs
positive and negative authorization tests. Its transport is replaced with a
deterministic in-memory response so the demo needs no OpenFGA server.
