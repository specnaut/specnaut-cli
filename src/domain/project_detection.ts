import type { VersionScheme } from "./installed_lock.ts";

/**
 * Tiny synchronous project-state facade — just what `detectVersionScheme`
 * needs. Implementations: a `Deno.statSync` / `Deno.readTextFileSync` +
 * `git tag -l` adapter in production, a fake map in tests.
 *
 * Synchronous on purpose: the detection runs once at init time, the
 * total work is reading a handful of small manifest files plus one
 * `git tag` invocation, and threading async through every helper just
 * to satisfy Deno globals here would muddy the domain port.
 */
export type ProjectSnapshot = {
  exists(rel: string): boolean;
  readText(rel: string): string | null;
  /**
   * Returns the list of local git tag names (`git tag -l` output, one
   * per line, no `refs/tags/` prefix). Returns `[]` when the project is
   * not a git repo, `git` is unavailable, or the subprocess fails — the
   * caller treats absence as "no signal", not as an error.
   */
  listTags(): readonly string[];
};

export type DetectionResult = {
  readonly suggestedScheme: VersionScheme;
  readonly evidence: ReadonlyArray<string>;
};

/**
 * Detects whether the user's project looks like a published library or
 * an app/SaaS by inspecting manifest files for "this is a library"
 * markers.
 *
 *   - Library markers found → suggest SemVer (consumers reason about
 *     breaking changes).
 *   - None found → suggest date-based (simpler; matches the "I don't
 *     want to think about major/minor/patch" SaaS use case).
 *
 * The user always sees the suggestion as a pre-selected default they
 * can override — this is a UX shortcut, not a contract.
 */
export function detectVersionScheme(snap: ProjectSnapshot): DetectionResult {
  const evidence: string[] = [];

  // npm: a `package.json` with an `exports` or `main` field is a
  // strong library signal. A bare `package.json` (Vite app, Next app,
  // Express service) typically has neither.
  if (snap.exists("package.json")) {
    const raw = snap.readText("package.json");
    if (raw !== null) {
      try {
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        if (typeof pkg.exports !== "undefined") {
          evidence.push("package.json exports field");
        } else if (typeof pkg.main === "string" && pkg.main.length > 0) {
          // `main` alone is weaker — many CLIs ship it. Only count it
          // when the package is also explicitly `private: false` or
          // has a `publishConfig`.
          if (pkg.private === false || typeof pkg.publishConfig === "object") {
            evidence.push("package.json main + publish intent");
          }
        }
      } catch {
        // malformed JSON — ignore for detection purposes
      }
    }
  }

  // Python: `pyproject.toml` with `[project]` or `[tool.poetry]` block.
  if (snap.exists("pyproject.toml")) {
    const raw = snap.readText("pyproject.toml");
    if (raw !== null) {
      if (/^\s*\[project\]\s*$/m.test(raw)) {
        evidence.push("pyproject.toml [project] block");
      } else if (/^\s*\[tool\.poetry\]\s*$/m.test(raw)) {
        evidence.push("pyproject.toml [tool.poetry] block");
      }
    }
  }

  // Rust: `Cargo.toml` with `[lib]`. Apps have `[[bin]]` instead.
  if (snap.exists("Cargo.toml")) {
    const raw = snap.readText("Cargo.toml");
    if (raw !== null) {
      if (/^\s*\[lib\]\s*$/m.test(raw)) {
        evidence.push("Cargo.toml [lib] section");
      }
    }
  }

  // PHP: `composer.json` with `"type": "library"`.
  if (snap.exists("composer.json")) {
    const raw = snap.readText("composer.json");
    if (raw !== null) {
      try {
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        if (pkg.type === "library") {
          evidence.push('composer.json type="library"');
        }
      } catch {
        // ignore
      }
    }
  }

  // Git tags: a repo that has already shipped one or more semver-shaped
  // tags is the strongest possible "this team uses SemVer" signal. We
  // intentionally exclude Specflow's own date-tag shape (`vYY.M.Da`,
  // identifiable by the trailing lowercase letter) so brownfield repos
  // that adopted Specflow earlier with date-tags don't get mis-suggested.
  //
  // Accepted shapes (case-insensitive, optional `v` prefix):
  //   v?MAJOR.MINOR.PATCH                      v1.2.3
  //   v?MAJOR.MINOR.PATCH-<pre-release>         v1.2.3-rc.1
  //   v?MAJOR.MINOR.PATCH+<build>               v1.2.3+build.5
  //
  // Rejected (treated as not-semver):
  //   anything with a trailing letter        v25.5.16a, v1.2.3foo
  //   anything missing the third component   v1.2, v1
  //   anything with a fourth component       v1.2.3.4
  const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/;
  const semverTags = snap.listTags().filter((t) => SEMVER_TAG_RE.test(t));
  if (semverTags.length > 0) {
    evidence.push(
      semverTags.length === 1
        ? `git tag ${semverTags[0]}`
        : `${semverTags.length} semver-shaped git tags (e.g. ${semverTags[0]})`,
    );
  }

  // Ruby: any `*.gemspec` at the repo root is a library marker.
  // The FS snapshot doesn't enumerate; the caller passes a `*.gemspec`
  // hint as a synthetic path. Implementation: convention — caller probes
  // `__gemspec_present__` for a flag, or we ask for a directory listing.
  // Simpler: skip ruby for v1; the heuristic is sufficient without it,
  // and adding directory enumeration to the FS port for one detector is
  // overkill. (Re-add when someone files an issue.)

  if (evidence.length > 0) {
    return { suggestedScheme: "semver", evidence };
  }
  return { suggestedScheme: "date", evidence: [] };
}
