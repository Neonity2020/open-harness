# Changesets

This repository uses Changesets to manage version bumps, changelog entries, npm publishes, and package tags for the public packages in `packages/*`.

## Release Flow

1. Create a changeset on your feature branch with `pnpm changeset` or the repo-local `/changeset` Claude command.
2. Merge the work to `main`.
3. From `main`, run `pnpm version-packages`.
4. Review and commit the generated package version and changelog updates.
5. Publish locally with `pnpm release:publish`.
6. Push the release commit and tags with `git push origin main --follow-tags`.

GitHub Releases are created automatically from pushed package tags.
