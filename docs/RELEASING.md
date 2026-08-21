# Releasing AuthFault

This project has not been published to npm yet. Complete this checklist before
creating the first release.

1. Confirm `main` is clean and current.
2. Run `npm ci`, `npm test`, both demos, and `npm pack --dry-run`.
3. Install the generated tarball in a separate real application and run
   `npx authfault doctor` followed by `npx authfault`.
4. Review the packaged file list for secrets, fixtures, or local artifacts.
5. Move the changelog's Unreleased entries into a dated version section.
6. Update the version with `npm version` and review the resulting commit and
   tag before pushing either.
7. Publish with npm provenance from the reviewed GitHub release workflow. Do
   not publish from an unreviewed workstation checkout.
8. Verify the public package in a clean temporary project using the exact
   README commands.
9. Create the GitHub release from the immutable version tag and include the
   relevant changelog section.

Never reuse or move a published version tag. Fix publication mistakes with a
new patch release.
