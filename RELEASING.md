# Releasing OpenHarness

OpenHarness uses [Changesets](https://github.com/changesets/changesets) for package versioning and changelog generation. Public packages are published locally to npm, and the same local release command pushes the release commit and tags and creates or updates the matching GitHub Releases.

## Published Packages

- `@openharness/core`
- `@openharness/react`
- `@openharness/vue`
- `@openharness/provider-vfs`

Apps and examples stay private and are ignored by Changesets.

## Contributor Flow

1. Make your package changes on a feature branch.
2. Create a changeset:

   ```bash
   pnpm changeset
   ```

   Or use the project-local Claude slash command:

   ```text
   /changeset
   ```

3. Commit the generated `.changeset/*.md` file with the rest of the change.

Each changeset should describe the user-facing change in plain language and use the smallest valid semver bump.

## Maintainer Release Flow

Run releases from a clean `main` checkout.

1. Check the pending release plan:

   ```bash
   pnpm release:status
   ```

2. Apply the pending version bumps and changelog updates:

   ```bash
   pnpm version-packages
   ```

3. Review the generated changes in `packages/*/package.json` and `packages/*/CHANGELOG.md`.
4. Commit the release artifacts:

   ```bash
   git add .changeset packages pnpm-lock.yaml
   git commit -m "Release packages"
   ```

5. Publish the new package versions locally and finalize the GitHub release:

   ```bash
   pnpm release:publish
   ```

   This command:

   - runs the test suite
   - builds the public packages
   - runs `changeset publish`
   - pushes the current branch and any new release tags to `origin`
   - creates or updates the GitHub Releases for the tags that point at `HEAD`
   - requires a clean worktree and an authenticated `gh` session

   If npm prompts for an OTP, complete it in the terminal. You can also pass one explicitly:

   ```bash
   pnpm release:publish -- --otp <code>
   ```

   If npm publish succeeds but GitHub release creation fails, fix the issue and rerun:

   ```bash
   pnpm release:github
   ```

   `pnpm release:github` only pushes the current branch and tags and then creates or updates the matching GitHub Releases for the release tags on `HEAD`.

   To backfill releases for tags that are already on GitHub from an older release commit, pass them explicitly:

   ```bash
   pnpm release:github -- @openharness/core@0.5.3 @openharness/react@0.2.6
   ```

6. Verify the releases in GitHub after the command completes.

## Claude Slash Commands

The repo includes project-local Claude skills under `.claude/skills/`. They show up as slash commands in Claude Code:

- `/changeset` drafts a `.changeset/*.md` file for the current branch.
- `/release-local` walks the maintainer through the local version, publish, push, and GitHub release flow.

These commands are repo-specific. They know which workspaces are publishable and which ones should be ignored.
