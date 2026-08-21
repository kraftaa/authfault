# Contributing to AuthFault

AuthFault is intentionally narrow: it tests whether an application enforces
observed authorization decisions. Changes should preserve that boundary.

## Development

Requirements: Node.js 20 or newer and npm.

```sh
npm ci
npm test
npm run demo
npm run demo:express
npm pack --dry-run
```

The Express demo opens an ephemeral localhost port. Restricted development
environments may require explicit permission for local network listeners.

## Pull requests

- Add tests for behavior changes and error cases.
- Keep the package free of runtime dependencies unless there is a compelling
  reason to change that constraint.
- Do not write request bodies, authorizer arguments, credentials, or personal
  data to traces or reports.
- Use plain-language report labels while retaining stable machine-readable
  outcome values.
- Describe limitations precisely; do not claim that a survivor is necessarily
  a vulnerability or that a killed fault proves security.

## Scope

Good contributions improve authorization-decision instrumentation, safe test
execution, targeted mutation runs, supported decision formats, or actionable
reporting. Policy authoring, authentication, production enforcement, hosted
dashboards, and vulnerability scanning are outside the current scope.
