import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveReleaseFromTag } from "./release-metadata.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  return result.stdout.trim();
}

function ensureGhAuth() {
  const result = spawnSync("gh", ["auth", "status"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  if (result.error) {
    console.error("GitHub CLI is required for local release creation.");
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("Run `gh auth login` before creating GitHub Releases locally.");
    process.exit(result.status ?? 1);
  }
}

function ensureBranch() {
  const branch = capture("git", ["branch", "--show-current"]);

  if (!branch) {
    console.error("Release publishing requires a checked out branch.");
    process.exit(1);
  }

  return branch;
}

function ensureCleanWorktree() {
  if (capture("git", ["status", "--short"])) {
    console.error("Release commands require a clean git worktree.");
    process.exit(1);
  }
}

function releasesForTags(tags) {
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => resolveReleaseFromTag(tag))
    .filter(Boolean)
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

function tagsPointingAtHead() {
  const output = capture("git", ["tag", "--points-at", "HEAD"]);
  return output ? output.split("\n") : [];
}

function tagExistsOnRemote(tag) {
  return capture("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "";
}

function withNotesFile(tag, notes, callback) {
  const dir = mkdtempSync(path.join(tmpdir(), "openharness-release-"));
  const notesPath = path.join(dir, `${tag.replaceAll("/", "-")}.md`);

  try {
    writeFileSync(notesPath, notes, "utf8");
    callback(notesPath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

const requestedTags = process.argv.slice(2);
const headTags = tagsPointingAtHead();
const tags = requestedTags.length > 0 ? requestedTags : headTags;
const releases = releasesForTags(tags);

if (releases.length === 0) {
  console.log("No matching public package release tags were found. Skipping GitHub Releases.");
  process.exit(0);
}

ensureCleanWorktree();
ensureGhAuth();
const shouldPush = releases.every((release) => headTags.includes(release.tag));

if (shouldPush) {
  const branch = ensureBranch();
  run("git", ["push", "origin", `HEAD:refs/heads/${branch}`, "--follow-tags"]);
} else {
  const missingRemoteTags = releases
    .map((release) => release.tag)
    .filter((tag) => !tagExistsOnRemote(tag));

  if (missingRemoteTags.length > 0) {
    console.error(
      `These tags do not point at HEAD and are not available on origin: ${missingRemoteTags.join(", ")}`,
    );
    process.exit(1);
  }
}

for (const release of releases) {
  withNotesFile(release.tag, release.notes, (notesPath) => {
    const existing = spawnSync("gh", ["release", "view", release.tag], {
      cwd: repoRoot,
      stdio: "ignore",
    });

    if (existing.status === 0) {
      run("gh", [
        "release",
        "edit",
        release.tag,
        "--title",
        release.title,
        "--notes-file",
        notesPath,
      ]);
      return;
    }

    run("gh", [
      "release",
      "create",
      release.tag,
      "--title",
      release.title,
      "--notes-file",
      notesPath,
    ]);
  });
}
