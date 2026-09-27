// A feature number is the handle code comments and commit messages use to cite
// a spec ("plan 041 FR-004"). It must never be handed out twice.
//
// `create-new-feature` used to compute the next number as
// max(spec dirs on disk, local branches, remote heads) + 1. The merge-close
// phase removes a shipped feature's spec directory, and the usual post-merge
// cleanup deletes its branch — after which nothing in that maximum still holds
// the shipped number, and the next feature gets it again. The slugs differ, so
// no path collides and nothing fails; every existing citation of the old number
// just quietly becomes ambiguous.
//
// The number survives in exactly one place both runners can read on any clone:
// the commit that added the directory. These tests put it only there.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const BASH = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/", import.meta.url),
);

const PWSH = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/powershell/", import.meta.url),
);

type Result = { code: number; stdout: string; stderr: string };

/** The options the scenarios need, independent of either script's flag spelling. */
type Opts = { dryRun: boolean; number?: number };

type Runner = { name: string; run: (opts: Opts, cwd: string) => Promise<Result> };

async function exec(bin: string, argv: string[], cwd: string): Promise<Result> {
  const { code, stdout, stderr } = await new Deno.Command(bin, {
    args: argv,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function hasPwsh(): Promise<boolean> {
  try {
    return (await exec("pwsh", ["-NoProfile", "-Command", "exit 0"], ".")).code === 0;
  } catch {
    return false;
  }
}

const PWSH_AVAILABLE = await hasPwsh();

const SHORT_NAME = "rate-limit-headers";
const DESCRIPTION = "Rate limit headers";

/**
 * One set of scenarios over both implementations. The acceptance criterion is
 * that both scripts compute the SAME next number from the same repository
 * state; two hand-kept copies of these tests would make that parity something
 * to remember rather than a property of the file.
 */
const RUNNERS: Runner[] = [
  {
    name: "bash",
    run: (o, cwd) =>
      exec("bash", [
        join(BASH, "create-new-feature.sh"),
        "--json",
        ...(o.dryRun ? ["--dry-run"] : []),
        ...(o.number !== undefined ? ["--number", String(o.number)] : []),
        "--short-name",
        SHORT_NAME,
        DESCRIPTION,
      ], cwd),
  },
];
if (PWSH_AVAILABLE) {
  RUNNERS.push({
    name: "pwsh",
    run: (o, cwd) =>
      exec("pwsh", [
        "-NoProfile",
        "-File",
        join(PWSH, "create-new-feature.ps1"),
        "-Json",
        ...(o.dryRun ? ["-DryRun"] : []),
        ...(o.number !== undefined ? ["-Number", String(o.number)] : []),
        "-ShortName",
        SHORT_NAME,
        DESCRIPTION,
      ], cwd),
  });
}

Deno.test("the PowerShell arm actually runs where it must", () => {
  // A missing interpreter must not quietly halve what this file covers.
  // GitHub-hosted runners ship pwsh on all three OSes, so on CI its absence is
  // a broken environment, not a local convenience.
  if (Deno.env.get("CI") === "true") {
    assert(PWSH_AVAILABLE, "pwsh is absent on CI — the PowerShell scenarios did not run");
  } else if (!PWSH_AVAILABLE) {
    console.log("  note: pwsh not installed — PowerShell scenarios skipped locally");
  }
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  const { code, stderr } = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(stderr)}`);
  }
}

async function write(root: string, rel: string, body: string): Promise<void> {
  const path = join(root, rel);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, body);
}

/**
 * Feature 041 planned, merged, shipped — then its spec directory removed on
 * `main` (merge-close step 8) and its branch deleted. Feature 001 is still on
 * disk, so the pre-fix answer is 002: an assertion of 042 can only be met by
 * reading the history.
 *
 * Two decoys sit in the same history, one per way a history reader can
 * over-count. A removed timestamp-prefixed spec dir must not read as feature
 * 20260101, and a numbered directory OUTSIDE the specs dir must not read as a
 * feature at all. Either mistake produces a number other than 042.
 */
async function withShippedFeature(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "cnf-number-reuse-" });
  try {
    await seed(dir);
    await ship041(dir);
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** A repository with feature 001 on disk and the two decoys in its history. */
async function seed(dir: string): Promise<void> {
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.email", "t@example.invalid");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "commit.gpgsign", "false");

  await write(dir, "README.md", "x\n");
  await write(dir, ".specnaut/specs/001-alpha/plan.md", "# Alpha\n");
  await write(dir, "docs/099-notes/readme.md", "not a feature\n");
  await write(dir, ".specnaut/specs/20260101-120000-spike/plan.md", "# Spike\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "init");
  await git(dir, "rm", "-rq", ".specnaut/specs/20260101-120000-spike");
  await git(dir, "commit", "-qm", "drop the spike");
}

/** Feature 041's whole life: planned on its branch, merged, branch deleted, directory removed. */
async function ship041(dir: string): Promise<void> {
  await git(dir, "checkout", "-qb", "041-export-csv");
  await write(dir, ".specnaut/specs/041-export-csv/plan.md", "# Export CSV\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "plan 041");
  await git(dir, "checkout", "-q", "main");
  await git(dir, "merge", "-q", "--ff-only", "041-export-csv");
  await git(dir, "branch", "-qD", "041-export-csv");
  await git(dir, "rm", "-rq", ".specnaut/specs/041-export-csv");
  await git(dir, "commit", "-qm", "chore: remove the spec directory for the shipped feature");
}

function featureNum(r: Result): string {
  assertEquals(r.code, 0, `exit ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  // The JSON object is the last stdout line; pwsh may print host noise first.
  const line = r.stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(line).FEATURE_NUM;
}

for (const runner of RUNNERS) {
  Deno.test(`create-new-feature [${runner.name}]: a shipped, removed feature's number is not reused (dry run)`, async () => {
    await withShippedFeature(async (dir) => {
      assertEquals(featureNum(await runner.run({ dryRun: true }, dir)), "042");
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`create-new-feature [${runner.name}]: a shipped, removed feature's number is not reused (real run)`, async () => {
    // The real run takes the fetch branch of the numbering code, not the
    // ls-remote one the dry run takes — a fix wired into one arm only would
    // pass the test above and reuse the number here.
    await withShippedFeature(async (dir) => {
      assertEquals(featureNum(await runner.run({ dryRun: false }, dir)), "042");
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`create-new-feature [${runner.name}]: a fresh clone does not reuse the number either`, async () => {
    // The fix may rely only on what git carries. A fresh clone has no local
    // feature branch, no untracked state and no remote head for 041 — just
    // the history of `origin/main`.
    await withShippedFeature(async (dir) => {
      const clone = await Deno.makeTempDir({ prefix: "cnf-number-reuse-clone-" });
      try {
        await git(clone, "clone", "-q", dir, ".");
        await git(clone, "config", "user.email", "t@example.invalid");
        await git(clone, "config", "user.name", "t");
        assertEquals(featureNum(await runner.run({ dryRun: false }, clone)), "042");
      } finally {
        await Deno.remove(clone, { recursive: true });
      }
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`create-new-feature [${runner.name}]: a number shipped since the last pull is counted after the fetch`, async () => {
    // Somebody else shipped 041 after this clone was made. Only the remote's
    // history holds it, and the local checkout never had it — so the history
    // read must span every ref, and must happen after the fetch that brings
    // `origin/main` up to date.
    const origin = await Deno.makeTempDir({ prefix: "cnf-number-reuse-origin-" });
    const clone = await Deno.makeTempDir({ prefix: "cnf-number-reuse-stale-" });
    try {
      await seed(origin);
      await git(clone, "clone", "-q", origin, ".");
      await git(clone, "config", "user.email", "t@example.invalid");
      await git(clone, "config", "user.name", "t");
      await ship041(origin);

      assertEquals(featureNum(await runner.run({ dryRun: false }, clone)), "042");
    } finally {
      await Deno.remove(origin, { recursive: true });
      await Deno.remove(clone, { recursive: true });
    }
  });
}

for (const runner of RUNNERS) {
  Deno.test(`create-new-feature [${runner.name}]: a directory with a non-ASCII name is still counted`, async () => {
    // git quotes such a path by default ("\303\251" escapes inside quotes),
    // and a quoted line no longer starts with the specs directory.
    await withShippedFeature(async (dir) => {
      await write(dir, ".specnaut/specs/060-résumé-export/plan.md", "# Résumé\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-qm", "plan 060");
      await git(dir, "rm", "-rq", ".specnaut/specs/060-résumé-export");
      await git(dir, "commit", "-qm", "remove 060");

      assertEquals(featureNum(await runner.run({ dryRun: true }, dir)), "061");
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`create-new-feature [${runner.name}]: an explicit number still overrides auto-detection`, async () => {
    await withShippedFeature(async (dir) => {
      assertEquals(featureNum(await runner.run({ dryRun: true, number: 7 }, dir)), "007");
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`create-new-feature [${runner.name}]: a directory that arrived as a rename is still counted`, async () => {
    // Plans start from one template, so two of them can be near-identical.
    // One commit that drops 040's plan and adds 041's is then a RENAME to
    // git's default diff — and 041 never shows up as an addition.
    await withShippedFeature(async (dir) => {
      await write(dir, ".specnaut/specs/050-seed/plan.md", "# Plan template\n\nSAME BODY\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-qm", "plan 050");
      await git(dir, "rm", "-rq", ".specnaut/specs/050-seed");
      await write(dir, ".specnaut/specs/051-follow-up/plan.md", "# Plan template\n\nSAME BODY\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-qm", "drop 050, plan 051");
      await git(dir, "rm", "-rq", ".specnaut/specs/051-follow-up");
      await git(dir, "commit", "-qm", "remove 051");

      assertEquals(featureNum(await runner.run({ dryRun: true }, dir)), "052");
    });
  });
}
