# Security policy

AuthFault deliberately changes authorization decisions and executes a project's
test command repeatedly. Run it only in isolated test environments with test
credentials and disposable or resettable state.

## Supported versions

AuthFault is pre-release software. Until the first public release, only the
latest commit on `main` receives security fixes.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security-advisory form:

https://github.com/kraftaa/authfault/security/advisories/new

Include the affected version or commit, reproduction steps, impact, and any
suggested mitigation. Do not include production credentials, authorization
requests, personal data, or customer data.

## Security boundaries

- AuthFault is a test tool, not a production authorization control.
- The CLI refuses `NODE_ENV=production` unless explicitly overridden.
- Traces contain point IDs, decisions, test IDs, and operation IDs—not
  authorizer arguments or request bodies.
- Test and reset commands execute with the invoking user's permissions.
- Survivor findings are evidence to investigate, not proof of a vulnerability.
