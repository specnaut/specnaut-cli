import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * Every action `release.yml` runs is pinned to a commit, not a tag.
 *
 * A major tag (`@v4`) is a pointer its owner moves on every minor and patch
 * release. For most actions that is a convenience; for `actions/attest` it is a
 * hazard, because the bundle it emits is a contract with binaries already
 * installed. The self-update verifier accepts one bundle shape (see
 * `verifiedSigningTime` in `src/domain/sigstore/verify.ts`), and an installed
 * binary cannot be taught a new shape by an update it refuses to verify. A
 * floating tag lets a third party change that shape on a release day, and the
 * only remedy is a manual reinstall by every user.
 *
 * So a version bump has to be a reviewed diff. The other actions in the file are
 * held to the same rule: one rule for the file is easier to keep than a list of
 * exceptions, and the pinned SHA is what actually runs either way.
 *
 * Scope is `release.yml` only. Other workflows produce nothing an installed
 * binary verifies.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const RELEASE_YML = `${ROOT}.github/workflows/release.yml`;

/** `owner/repo[/path]@<40 hex>` — a commit, never a tag or branch name. */
const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/;

type Workflow = {
  jobs: Record<string, { uses?: string; steps?: { uses?: string }[] }>;
};

/**
 * Every `uses:` the runner will resolve — job-level (reusable workflows) and
 * step-level — read from the parsed document, so no quoting or flow style can
 * hide one from a line-oriented scan.
 */
function parsedUses(text: string): string[] {
  const wf = parse(text) as Workflow;
  return Object.values(wf.jobs).flatMap((job) => [
    ...(job.uses ? [job.uses] : []),
    ...(job.steps ?? []).flatMap((s) => (s.uses ? [s.uses] : [])),
  ]);
}

/** The raw `uses:` lines — the only place the version comment survives. */
function rawUsesLines(text: string): string[] {
  return text.split("\n").filter((l) => /^\s*(-\s+)?uses:/.test(l));
}

Deno.test("release.yml — every action is pinned to a full commit SHA", async () => {
  const uses = parsedUses(await Deno.readTextFile(RELEASE_YML));
  assert(uses.length > 0, "found no `uses:` in release.yml — the parser is not reading the file");
  const floating = uses.filter((u) => !PINNED.test(u));
  assertEquals(floating, [], `not pinned to a 40-character commit SHA: ${floating.join(", ")}`);
});

Deno.test("release.yml — every pin names the version it corresponds to", async () => {
  const text = await Deno.readTextFile(RELEASE_YML);
  const lines = rawUsesLines(text);
  // The line scan must see what the parser sees, or it is blind to part of the
  // surface this test claims to cover.
  assertEquals(lines.length, parsedUses(text).length, "line scan and YAML parse disagree");
  for (const line of lines) {
    assertMatch(
      line,
      /@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/,
      `pin without a version comment: ${line}`,
    );
  }
});

Deno.test("release.yml — the attest step says why it must not float", async () => {
  const text = await Deno.readTextFile(RELEASE_YML);
  const start = text.indexOf("- name: Attest build provenance");
  assert(start >= 0, "no 'Attest build provenance' step");
  const end = text.indexOf("- name:", start + 1);
  const step = text.slice(start, end < 0 ? undefined : end);
  assertStringIncludes(step, "actions/attest@");
  // The comment points at the verifier the bundle shape has to be checked
  // against — the one thing a future bump must not skip.
  assertStringIncludes(step, "verifiedSigningTime");
});
