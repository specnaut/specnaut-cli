import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * Every action a workflow that can mint an OIDC token runs is pinned to a
 * commit, not a tag — and `release.yml` can never be called by another one.
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
 * So a version bump has to be a reviewed diff. The other actions in such a file
 * are held to the same rule: one rule per file is easier to keep than a list of
 * exceptions, and the pinned SHA is what actually runs either way.
 *
 * Scope is keyed on the PERMISSION, not on a file name (cli#662): any workflow
 * requesting `id-token: write` — `release.yml` and the Go dry run today — can
 * sign as this repository, so a floating action in any of them runs with that
 * power. A per-file list is the one a new signing workflow is missing from.
 *
 * And `release.yml` stays uncallable: its triggers are exactly `push: tags`. A
 * `workflow_call` or `workflow_dispatch` added "for the dry run" would let
 * another workflow mint the release identity that every installed binary
 * trusts, for any tag, irreversibly.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOWS = `${ROOT}.github/workflows`;
const RELEASE_YML = `${WORKFLOWS}/release.yml`;

/** `owner/repo[/path]@<40 hex>` — a commit, never a tag or branch name. */
const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/;

type Permissions = Record<string, string> | string | undefined;
type Workflow = {
  on?: unknown;
  permissions?: Permissions;
  jobs: Record<string, { uses?: string; permissions?: Permissions; steps?: { uses?: string }[] }>;
};

function grantsIdToken(p: Permissions): boolean {
  return p === "write-all" || (typeof p === "object" && p?.["id-token"] === "write");
}

/** Every workflow requesting `id-token: write`, at the top or in any job. */
async function signingWorkflows(): Promise<{ name: string; text: string }[]> {
  const out = [];
  for await (const e of Deno.readDir(WORKFLOWS)) {
    if (!/\.ya?ml$/.test(e.name)) continue;
    const text = await Deno.readTextFile(`${WORKFLOWS}/${e.name}`);
    const wf = parse(text) as Workflow;
    const jobs = Object.values(wf.jobs ?? {});
    if (grantsIdToken(wf.permissions) || jobs.some((j) => grantsIdToken(j.permissions))) {
      out.push({ name: e.name, text });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

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

Deno.test("release.yml requests id-token, so the pinning scope cannot be empty", async () => {
  const names = (await signingWorkflows()).map((w) => w.name);
  assert(names.includes("release.yml"), `signing workflows found: ${names.join(", ")}`);
});

Deno.test("every id-token workflow pins every action to a full commit SHA", async () => {
  for (const { name, text } of await signingWorkflows()) {
    const uses = parsedUses(text);
    assert(uses.length > 0, `found no \`uses:\` in ${name} — the parser is not reading the file`);
    const floating = uses.filter((u) => !PINNED.test(u));
    assertEquals(
      floating,
      [],
      `${name}: not pinned to a 40-character commit SHA: ${floating.join(", ")}`,
    );
  }
});

Deno.test("every id-token workflow names the version each pin corresponds to", async () => {
  for (const { name, text } of await signingWorkflows()) {
    const lines = rawUsesLines(text);
    // The line scan must see what the parser sees, or it is blind to part of
    // the surface this test claims to cover.
    assertEquals(
      lines.length,
      parsedUses(text).length,
      `${name}: line scan and YAML parse disagree`,
    );
    for (const line of lines) {
      assertMatch(
        line,
        /@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/,
        `${name}: pin without a version comment: ${line}`,
      );
    }
  }
});

Deno.test("release.yml is triggered by tag pushes and nothing else", async () => {
  const wf = parse(await Deno.readTextFile(RELEASE_YML)) as Workflow;
  const on = wf.on as Record<string, Record<string, unknown>>;
  assertEquals(
    Object.keys(on ?? {}),
    ["push"],
    "release.yml gained a trigger: it must never be callable",
  );
  assertEquals(Object.keys(on.push ?? {}), ["tags"], "release.yml's push trigger is not tags-only");
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
