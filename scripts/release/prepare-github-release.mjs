import { appendFileSync, writeFileSync } from "node:fs";

import { resolveReleaseFromTag } from "./release-metadata.mjs";

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const [tag, outputPath] = process.argv.slice(2);

if (!tag || !outputPath) {
  console.error("Usage: node scripts/release/prepare-github-release.mjs <tag> <output-path>");
  process.exit(1);
}

const release = resolveReleaseFromTag(tag);

if (!release) {
  setOutput("should_release", "false");
  console.log(`Skipping tag ${tag}: no matching public workspace package version.`);
  process.exit(0);
}

writeFileSync(outputPath, release.notes, "utf8");
setOutput("should_release", "true");
setOutput("title", release.title);

console.log(`Prepared release notes for ${tag}`);
