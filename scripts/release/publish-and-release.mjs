import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const publishArgs = process.argv.slice(2);

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

function ensureCleanWorktree() {
  if (capture("git", ["status", "--short"])) {
    console.error("Release commands require a clean git worktree.");
    process.exit(1);
  }
}

const beforeTags = new Set(
  capture("git", ["tag", "--points-at", "HEAD"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean),
);

ensureCleanWorktree();
run("pnpm", ["test"]);
run("pnpm", ["--filter", "./packages/*", "-r", "build"]);
run("pnpm", ["changeset", "publish", ...publishArgs]);

const newTags = capture("git", ["tag", "--points-at", "HEAD"])
  .split("\n")
  .map((tag) => tag.trim())
  .filter(Boolean)
  .filter((tag) => !beforeTags.has(tag));

if (newTags.length === 0) {
  console.log("No new release tags were created. Skipping GitHub release creation.");
  process.exit(0);
}

run("node", ["scripts/release/push-and-release.mjs", ...newTags]);
