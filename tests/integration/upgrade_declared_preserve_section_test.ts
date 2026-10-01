import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #474 — a declared preserve wins over the managed-section merge too.
 *
 * Spec 011 / #367: a path listed in `.specnaut/preserve.yml` beats every other
 * branch of the plan, `--force` included; only `--reset-preserved` lifts it.
 * #466's section merge iterated the bundle directly and never consulted that
 * predicate, so a file the maintainer had frozen was written anyway — and the
 * same run printed both "preserved … declared" and "added the … section" for
 * it. Two statements about one file, in one output, contradicting each other.
 *
 * Found by dogfooding v2.0.1 on the workspace that ships it, not by a report.
 */

const HEADING = "## The Specnaut chain runs on autopilot after the plan";
const OWN = "# AGENTS.md\n\n## House rules\n\nWe rebase, never merge commits.\n";
const PRESERVE_YML = "preserved:\n  - AGENTS.md\n";

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
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

const INIT = ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"];

/** Scaffolds a project whose own AGENTS.md is declared frozen. */
async function frozenProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-declared-section-" });
  await Deno.writeTextFile(join(dir, "AGENTS.md"), OWN);
  const init = await runSpecnaut(INIT, dir);
  assertEquals(init.code, 0, `init failed: ${init.stderr}`);
  await Deno.writeTextFile(join(dir, ".specnaut/preserve.yml"), PRESERVE_YML);
  return dir;
}

Deno.test("a declared AGENTS.md does not receive the managed section", async () => {
  const dir = await frozenProject();
  try {
    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
    assertEquals(
      await Deno.readTextFile(join(dir, "AGENTS.md")),
      OWN,
      "a frozen file must come back byte-identical",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("--force does not lift the declaration either", async () => {
  // FR-009: only --reset-preserved overrides a declaration. --force is for
  // *customized* preserves, which is a different thing entirely.
  const dir = await frozenProject();
  try {
    const up = await runSpecnaut(["upgrade", "--force"], dir);
    assertEquals(up.code, 0, `forced upgrade failed: ${up.stderr}`);
    assertEquals(await Deno.readTextFile(join(dir, "AGENTS.md")), OWN);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("--reset-preserved does deliver the section", async () => {
  // The escape hatch has to actually work, or the fix above is just a wall.
  const dir = await frozenProject();
  try {
    const up = await runSpecnaut(["upgrade", "--reset-preserved"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
    const after = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assert(after.startsWith(OWN.trimEnd()), "the user's content is still the prefix");
    assert(after.includes(HEADING), "lifting the declaration must deliver the section");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("one run never claims a path is both preserved and modified", async () => {
  const dir = await frozenProject();
  try {
    const up = await runSpecnaut(["upgrade"], dir);
    assert(
      up.stdout.includes("preserved AGENTS.md"),
      "a declared path must still be reported as preserved",
    );
    // The merge notice must be absent — that is the contradiction the fix removes.
    assert(
      !up.stdout.includes("Specnaut-managed"),
      "a frozen file must not also be announced as having a section added",
    );
    // ...and so must the diff, whose banner offers --force and --reset-baseline,
    // neither of which does anything to a declared path.
    assert(
      !up.stdout.includes("---- diff: AGENTS.md ----"),
      "a declared preserve must not be diffed under the customized-file advice",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
