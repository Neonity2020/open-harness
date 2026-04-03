import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function loadPackages() {
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

export function extractReleaseNotes(pkg) {
  const changelogPath = path.join(pkg.dir, "CHANGELOG.md");

  if (!existsSync(changelogPath)) {
    return `Release published for \`${pkg.name}\` version \`${pkg.version}\`.\n`;
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const sectionPattern = new RegExp(`^##\\s+${escapeRegExp(pkg.version)}\\s*$`, "m");
  const match = sectionPattern.exec(changelog);

  if (!match) {
    return `Release published for \`${pkg.name}\` version \`${pkg.version}\`.\n`;
  }

  const sectionStart = match.index + match[0].length;
  const remaining = changelog.slice(sectionStart);
  const nextSection = remaining.search(/\n##\s+/);
  const sectionBody = nextSection === -1 ? remaining : remaining.slice(0, nextSection);
  const lines = sectionBody.trim().split("\n");

  while (lines[0] === "") {
    lines.shift();
  }

  const notes = lines.join("\n").trim();
  return notes ? `${notes}\n` : `Release published for \`${pkg.name}\` version \`${pkg.version}\`.\n`;
}

export function resolveReleaseFromTag(tag) {
  const pkg = loadPackages().find((entry) => `${entry.name}@${entry.version}` === tag);

  if (!pkg) {
    return null;
  }

  return {
    notes: extractReleaseNotes(pkg),
    tag,
    title: `${pkg.name} v${pkg.version}`,
  };
}
