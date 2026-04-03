# Releasing OpenHarness

OpenHarness uses [Changesets](https://github.com/changesets/changesets) for package versioning and changelog generation. Public packages are published locally to npm, while GitHub Releases are created automatically after the resulting package tags are pushed.

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

5. Publish the new package versions locally:

   ```bash
   pnpm release:publish
   ```

   If npm prompts for an OTP, complete it in the terminal. You can also pass one explicitly:

   ```bash
   pnpm release:publish -- --otp <code>
   ```

6. Push the release commit and tags:

   ```bash
   git push origin main --follow-tags
   ```

Once the tags reach GitHub, the `GitHub Releases` workflow creates one GitHub Release per published package tag using the corresponding `CHANGELOG.md` entry.

## Claude Slash Commands

The repo includes project-local Claude skills under `.claude/skills/`. They show up as slash commands in Claude Code:

- `/changeset` drafts a `.changeset/*.md` file for the current branch.
- `/release-local` walks the maintainer through the local version and publish flow.

These commands are repo-specific. They know which workspaces are publishable and which ones should be ignored.
