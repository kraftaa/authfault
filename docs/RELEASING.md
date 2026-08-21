# Releasing AuthFault

This project has not been published to npm yet. Complete this checklist before
creating the first release.

## First-release prerequisites

- Make the GitHub repository public before publishing. npm provenance is not
  generated from private repositories.
- Sign in to the npm account that will own `authfault`, enable 2FA, and add an
  `NPM_TOKEN` secret to the protected GitHub `npm` environment. The package does
  not exist yet, so a trusted publisher cannot be configured until after the
  first publication.
- Require a reviewer for the GitHub `npm` environment. Publishing a GitHub
  release triggers `.github/workflows/publish.yml`.
- Immediately after the first publication, configure npm trusted publishing
  for `kraftaa/authfault` and `publish.yml`, then remove the long-lived
  `NPM_TOKEN` from GitHub.

The unscoped name `authfault` was available when release readiness was last
checked, but registry names are not reserved until publication.

1. Confirm `main` is clean and current.
2. Run `npm ci`, `npm test`, all demos, and `npm pack --dry-run`.
3. Install the generated tarball in a separate real application and run
   `npx authfault doctor` followed by `npx authfault`.
4. Review the packaged file list for secrets, fixtures, or local artifacts.
5. Move the changelog's Unreleased entries into a dated version section.
6. Update the version with `npm version` and review the resulting commit and
   tag before pushing either.
7. Publish with npm provenance from the reviewed GitHub release workflow. Do
   not publish from an unreviewed workstation checkout. For the first release,
   the workflow uses `NPM_TOKEN`; subsequent releases should use npm trusted
   publishing through OIDC.
8. Verify the public package in a clean temporary project using the exact
   README commands.
9. Create the GitHub release from the immutable version tag and include the
   relevant changelog section.

Never reuse or move a published version tag. Fix publication mistakes with a
new patch release.
