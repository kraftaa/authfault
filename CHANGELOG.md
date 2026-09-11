# Changelog

All notable changes will be documented here. AuthFault follows semantic
versioning after its first public release.

## [Unreleased]

### Added

- Authorization fault injection for boolean, object, guard, Cedar, Amazon
  Verified Permissions, and custom structured decisions.
- `node:test`, Vitest, and Bun attribution adapters.
- Point-wide and occurrence-level mutations.
- Survivor review baselines with owners, reasons, and expiration dates.
- `authfault init`, `authfault doctor`, and default `npm test` execution.
- GitHub Actions summaries and the `--fail-on-gap` CI option.
- Multi-layer compensating-control correlation.
- Clean consumer-package installation verification.
- Multi-tenant service and Express HTTP examples.
- One-time OpenFGA client instrumentation that preserves existing `check`
  call sites.
- Authorization-point inventory and richer coverage diagnostics in `doctor`.
- A real-SDK OpenFGA example and five-minute integration guide.

### Security

- Production-mode refusal unless explicitly overridden.
- Per-process metadata-only traces that omit authorization request contents.
- Optional reset commands before baseline, control, and mutation executions.
