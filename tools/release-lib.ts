// Checks a release must pass, used by tools/release.ts on the maintainer's machine and by
// the release workflow in CI. Pure functions, tested in test/tools/release.test.ts.

/** The entries under "## <version> (...)" in CHANGELOG.md, or null when there is none. */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

/** Why a tag may not be released: its form, its match with package.json, its dated changelog entry. */
export function tagProblems(tag: string, pkgVersion: string, changelog: string): string[] {
  if (!tag.startsWith("v")) return [`tag ${tag} must start with "v"`];
  const version = tag.slice(1);
  const problems: string[] = [];
  if (version !== pkgVersion) problems.push(`tag ${tag} does not match package.json version ${pkgVersion}`);
  const heading = changelog.replace(/\r\n/g, "\n").split("\n").find((l) => new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`).test(l));
  if (!heading) problems.push(`CHANGELOG.md has no entry for ${version}`);
  else if (!/\(\d{2}\/\d{2}\/\d{4}\)/.test(heading)) problems.push(`CHANGELOG.md's ${version} entry has no release date (DD/MM/YYYY)`);
  return problems;
}

/**
 * The files in `npm pack --dry-run --json` output, with forward slashes. npm 11 prints a list
 * of packages; npm 12 prints an object keyed by package name.
 */
export function packedFiles(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  const entries = (Array.isArray(parsed) ? parsed : Object.values(parsed as object)) as { files?: { path: string }[] }[];
  const files = entries[0]?.files;
  if (!files) throw new Error("npm pack --json listed no package");
  return files.map((f) => f.path.replace(/\\/g, "/"));
}

const REQUIRED = ["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "dist/cli.js"];

/** What is wrong with the list of files `npm pack` would publish. */
export function packProblems(files: string[]): string[] {
  const set = new Set(files.map((f) => f.replace(/^package\//, "")));
  const problems = REQUIRED.filter((f) => !set.has(f)).map((f) => `${f} is missing`);
  for (const f of set) {
    if (REQUIRED.includes(f) || f.startsWith("dist/")) continue;
    problems.push(`${f} should not be published`);
  }
  return problems;
}

/** Strings shaped like a SocialCrawl API key (sc_<label>_<long secret>). */
export function keyShaped(text: string): string[] {
  return [...text.matchAll(/\bsc_[A-Za-z0-9]+_[A-Za-z0-9]{30,}\b/g)].map((m) => m[0]);
}
