import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadPackages() {
  const packagesDir = path.join(repoRoot, "packages");

  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(packagesDir, entry.name);
      const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

      return {
        dir,
        name: manifest.name,
        private: Boolean(manifest.private),
        version: manifest.version,
      };
    })
    .filter((pkg) => !pkg.private);
}

function extractReleaseNotes(pkg) {
  const changelogPath = path.join(pkg.dir, "CHANGELOG.md");

  if (!existsSync(changelogPath)) {
    return `Release published for \`${pkg.name}\` version \`${pkg.version}\`.\n`;
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const sectionPattern = new RegExp(
    `^##\\s+${escapeRegExp(pkg.version)}(?:\\s|$)[\\s\\S]*?(?=^##\\s+|\\Z)`,
    "m",
  );
  const match = changelog.match(sectionPattern);

  if (!match) {
    return `Release published for \`${pkg.name}\` version \`${pkg.version}\`.\n`;
  }

  const lines = match[0].trim().split("\n");
  lines.shift();

  while (lines[0] === "") {
    lines.shift();
  }

  const notes = lines.join("\n").trim();
  return notes ? `${notes}\n` : `Release published for \`${pkg.name}\` version \`${pkg.version}\`.\n`;
}

const [tag, outputPath] = process.argv.slice(2);

if (!tag || !outputPath) {
  console.error("Usage: node scripts/release/prepare-github-release.mjs <tag> <output-path>");
  process.exit(1);
}

const pkg = loadPackages().find((entry) => `${entry.name}@${entry.version}` === tag);

if (!pkg) {
  setOutput("should_release", "false");
  console.log(`Skipping tag ${tag}: no matching public workspace package version.`);
  process.exit(0);
}

const title = `${pkg.name} v${pkg.version}`;
writeFileSync(outputPath, extractReleaseNotes(pkg), "utf8");
setOutput("should_release", "true");
setOutput("title", title);

console.log(`Prepared release notes for ${tag}`);
