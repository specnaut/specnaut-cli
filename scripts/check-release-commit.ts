// check-release-commit — the gate between the release commit and `git tag`.
//
// Usage: deno run --allow-read --allow-run scripts/check-release-commit.ts v3.0.0
//
// Five things must hold at the moment a release tag is created, and none of
// them is checked by anything else in the pipeline:
//
//   1. The working tree is clean. A tag records a commit; anything uncommitted
//      is simply not in the release, and the difference is invisible from the
//      tag afterwards.
//   2. All the version files agree with the tag (the marketplace catalogs by
//      their entries' `ref`). They are written in lockstep
//      by `bump-version.ts`, but nothing stops a hand-edit or a partial revert
//      from desyncing them, and a binary whose `--version` disagrees with its
//      templates manifest is a support ticket nobody can reproduce.
//   3. The highlights file, if it has content, was written for *this* release.
//      It is tracked and nothing truncates it, so the default behaviour is to
//      republish the previous release's prose verbatim above a commit list
//      that contradicts it. A missing section is visibly missing; stale prose
//      reads as authored and current, which is worse.
//   4. HEAD is the release commit. In v3.0.0 the bump was swept into a
//      `feat(...)` commit by a stray `git add -A` and the tag landed on it.
//      Harmless that time — the tree was correct — but it is only luck that
//      separates "the bump rode along with a feature" from "the tag captured
//      half a feature". This is the check that would have said so.
//   5. The release records its highlights in `.specnaut/release/history/<tag>.md`,
//      equal to `HIGHLIGHTS.md` (cli#759). The binary embeds that history and
//      `specnaut upgrade` prints it for every release it crosses, so a record
//      missing or out of step would show the wrong words, or none.
//
// Exit 0 = safe to tag. 1 = do not tag. 2 = usage/environment error.

import { VERSIONED_FILES } from "./bump-version.ts";
import { releaseRefProblems } from "./catalog-refs.ts";
import { git } from "./git.ts";

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Highlights compared whitespace-insensitively: reflowing is exactly the edit
 * that must NOT count as rewriting, and `deno fmt` performs it unasked.
 */
export const flat = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Every place a version can hide in these files: a JSON `"version": "x"` field
 * and the TypeScript `VERSION` constant. (Catalogs are read by catalog-refs.ts.) Deliberately not anchored to a single
 * shape — the point is to catch a file that disagrees, whatever its format.
 */
export function versionsIn(content: string): string[] {
  const found = [
    ...content.matchAll(/"version"\s*:\s*"([^"]+)"/g),
    ...content.matchAll(/VERSION\s*=\s*"([^"]+)"/g),
  ].map((m) => m[1]);
  return [...new Set(found)];
}

/** `path`'s text, or null when it does not exist; any other failure throws. */
async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw new Error(`${path} could not be read: ${(err as Error).message}`);
  }
}

async function main() {
  const tag = Deno.args[0];
  if (!tag) {
    console.error("usage: check-release-commit.ts <tag>   (e.g. v3.0.0)");
    Deno.exit(2);
  }
  if (!SEMVER_TAG.test(tag)) {
    console.error(`check-release-commit: "${tag}" is not a vMAJOR.MINOR.PATCH tag`);
    Deno.exit(2);
  }
  const expected = tag.slice(1);
  const problems: string[] = [];

  const dirty = await git("status", "--porcelain");
  if (dirty) {
    problems.push(
      `working tree is dirty — these changes would not be in ${tag}:\n` +
        dirty.split("\n").map((l) => `      ${l}`).join("\n"),
    );
  }

  for (const file of VERSIONED_FILES) {
    const content = await readIfPresent(file);
    if (content === null) {
      problems.push(`${file} is missing`);
      continue;
    }
    // A catalog, the settings and the README pin by `ref`, not by `version`: one
    // definition of "pinned to this release", shared with the bump and release.yml.
    const refProblems = releaseRefProblems(file, content, tag);
    if (refProblems !== null) {
      for (const p of refProblems) problems.push(`${file}: ${p}`);
      continue;
    }
    const found = versionsIn(content);
    if (found.length === 0) {
      problems.push(`${file} declares no version at all`);
    } else if (!found.includes(expected)) {
      problems.push(`${file} declares ${found.join(", ")}, expected ${expected}`);
    }
  }

  // The highlights file is the one part of the release notes a human writes,
  // so nothing downstream regenerates it — which means nothing downstream
  // notices when it is a release out of date.
  const HIGHLIGHTS = ".specnaut/release/HIGHLIGHTS.md";
  // Absent is fine: a release with no hand-written lead is the normal case.
  // Any other failure to read it is reported, never read as absent.
  const highlightsBody = await readIfPresent(HIGHLIGHTS) ?? "";
  if (highlightsBody.trim()) {
    // No tag at all: a first release, nothing can be stale yet. With tags, a
    // describe that fails is git's failure, reported, never a first release.
    const anyTag = await git("tag", "--list") !== "";
    const prevTag = anyTag ? await git("describe", "--tags", "--abbrev=0", "HEAD") : "";
    if (prevTag) {
      // Compare CONTENT against what was published at the previous tag, not the
      // provenance of the last commit that touched the file.
      //
      // The provenance form asked "is the last commit touching HIGHLIGHTS.md an
      // ancestor of the previous tag?" — so ANY later commit cleared the flag,
      // including one that changed nothing a reader would see. Observed: a
      // whitespace reflow landed six minutes after v4.1.0 was tagged and left
      // the gate green over that release's own lead, word for word. A guard that
      // reads when a file was touched cannot answer a question about what it
      // says.
      // Absent at the previous tag: nothing to have republished. `ls-tree`
      // lists nothing for an absent path and fails only when git does.
      const there = await git("ls-tree", "--name-only", prevTag, "--", HIGHLIGHTS) !== "";
      const published = there ? await git("show", `${prevTag}:${HIGHLIGHTS}`) : "";
      const stale = published.trim().length > 0 &&
        flat(published) === flat(highlightsBody);
      if (stale) {
        problems.push(
          `${HIGHLIGHTS} still carries the lead already published at ${prevTag}.\n` +
            `      Those highlights were already published. Rewrite them for ${tag}, ` +
            `or empty the file — an empty one renders nothing.`,
        );
      }
    }
  }

  const record = `.specnaut/release/history/${tag}.md`;
  const recorded = await readIfPresent(record);
  if (recorded === null) {
    problems.push(`${record} is missing — copy ${HIGHLIGHTS} to it, then bundle and commit`);
  } else if (flat(recorded) !== flat(highlightsBody)) {
    problems.push(`${record} differs from ${HIGHLIGHTS} — copy it again, then bundle and commit`);
  }

  const subject = await git("log", "-1", "--format=%s");
  if (subject !== `chore: release ${tag}`) {
    problems.push(
      `HEAD is "${subject}" — expected "chore: release ${tag}".\n` +
        `      The bump must be its own commit; a tag that lands on a feature ` +
        `commit captures whatever else that commit carried.`,
    );
  }

  if (problems.length > 0) {
    console.error(`check-release-commit: ${problems.length} problem(s) — do NOT tag ${tag}\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    Deno.exit(1);
  }
  console.log(
    `check-release-commit: ✓ HEAD is the release commit for ${tag}, all ${VERSIONED_FILES.length} version files agree`,
  );
}

if (import.meta.main) {
  // A failure is reported as one, and refuses the tag: exit 1, never a pass.
  await main().catch((e: Error) => {
    console.error(`check-release-commit: ✗ ${e.message} — do NOT tag`);
    Deno.exit(1);
  });
}
