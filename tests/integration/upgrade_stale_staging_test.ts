import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #477 — `upgrade --force` must not leave staged copies of files it wrote.
 *
 * Staging exists so `reconcile` can offer the upstream version of a file the
 * run refused to touch. A file `--force` overwrote has nothing left to
 * reconcile — its destination IS the upstream — so the staged copy is stale.
 *
 * Left behind, it inflated `reconcile --status` permanently. On the workspace
 * where this was found, a forced upgrade reported 46 pending paths, 23 of them
 * byte-identical to their staged copy. The assertions below are on the COUNT,
 * because the failure mode is an over-long list, not an error: every command
 * exited 0 throughout.
 */

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
const CUSTOMIZED = [
  ".claude/skills/specnaut/phases/tasks.md",
  ".claude/skills/specnaut/phases/review.md",
];

async function pending(dir: string): Promise<string[]> {
  const r = await runSpecnaut(["reconcile", "--status"], dir);
  assertEquals(r.code, 0, `reconcile failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { pending: string[] }).pending;
}

/** Scaffolds a project with two locally-customized managed files. */
async function customizedProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-stale-staging-" });
  assertEquals((await runSpecnaut(INIT, dir)).code, 0);
  for (const rel of CUSTOMIZED) {
    const abs = join(dir, rel);
    await Deno.writeTextFile(abs, (await Deno.readTextFile(abs)) + "\n<!-- ours -->\n");
  }
  return dir;
}

Deno.test("a forced upgrade leaves nothing pending for the files it overwrote", async () => {
  const dir = await customizedProject();
  try {
    const up = await runSpecnaut(["upgrade", "--force"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    const after = await pending(dir);
    for (const rel of CUSTOMIZED) {
      assert(
        !after.includes(rel),
        `${rel} was overwritten by --force, so it must not be pending reconciliation`,
      );
    }
    assertEquals(after.length, 0, `nothing should be pending, got: ${after.join(", ")}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a dry run stages nothing — it is a preview, not a partial upgrade", async () => {
  // This reverses a deliberate earlier choice (#516). Staging during --dry-run
  // was introduced so an agent could preview the reconciliation before
  // committing to it. The cost turned out to be higher than the benefit: the
  // run wrote dozens of files and then printed "no files written", and it left
  // `specnaut reconcile` primed with upstream content for an upgrade that was
  // never applied — a pending reconciliation for a decision nobody took.
  //
  // The preview survives without the writes: the plan already names every
  // customized dest, and `specnaut diff` shows the content.
  const dir = await customizedProject();
  try {
    const dry = await runSpecnaut(["upgrade", "--dry-run"], dir);
    assertEquals(dry.code, 0, `dry-run failed: ${dry.stderr}`);

    assertEquals(await pending(dir), [], "a dry run must leave nothing staged");
    for (const rel of CUSTOMIZED) {
      assertStringIncludes(dry.stdout, rel);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an unforced upgrade keeps the staged copy it did not write", async () => {
  // A preserved file genuinely still needs reconciling — clearing it would be
  // the opposite bug, and would lose the upstream copy the user needs.
  const dir = await customizedProject();
  try {
    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    const after = await pending(dir);
    for (const rel of CUSTOMIZED) {
      assert(after.includes(rel), `${rel} was preserved, so it must stay pending`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * #613 — staged copies an OLDER upgrade left behind.
 *
 * #477 cleared staging only for the dests the current run writes. A project
 * that upgraded without reconciling, and then upgraded again across several
 * releases, kept every staged copy the earlier runs had made: retired files the
 * bundle no longer ships, `skipIfExists` files the lock deliberately does not
 * track, files whose destination already equals the new upstream. `reconcile
 * <path>` refuses the first two with "is not tracked by Specnaut", so the queue
 * could never be emptied and the review marker could never be retired.
 */
const STALE = {
  /** Retired upstream: neither in the bundle, nor in the lock, nor on disk. */
  retired: ".claude/commands/retired-command.md",
  /** On disk and user-owned (`skipIfExists`), so the lock carries no entry. */
  untracked: "AGENTS.md",
  /** Tracked, and its destination already IS the new upstream. */
  unchanged: ".claude/skills/specnaut/phases/plan.md",
};

async function seedStaleStaging(dir: string): Promise<void> {
  for (const rel of Object.values(STALE)) {
    const abs = join(dir, ".specnaut/upgrade-staging", rel);
    await Deno.mkdir(join(abs, ".."), { recursive: true });
    await Deno.writeTextFile(abs, "UPSTREAM FROM AN OLDER RELEASE\n");
  }
}

async function stagedOnDisk(dir: string, rel: string): Promise<boolean> {
  try {
    await Deno.stat(join(dir, ".specnaut/upgrade-staging", rel));
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

Deno.test("an applied upgrade clears the staged copies an older upgrade left behind", async () => {
  const dir = await customizedProject();
  try {
    await seedStaleStaging(dir);

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    // Asserted on the staging tree, not on `--status`: the listing filters
    // unresolvable paths on its own, so it would pass without the prune.
    for (const rel of Object.values(STALE)) {
      assert(!(await stagedOnDisk(dir, rel)), `${rel} is stale and must be pruned by upgrade`);
    }
    for (const rel of CUSTOMIZED) {
      assert(await stagedOnDisk(dir, rel), `${rel} was staged by this run and must stay`);
    }
    assertEquals((await pending(dir)).sort(), [...CUSTOMIZED].sort());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an up-to-date upgrade clears them too", async () => {
  // The reporter's project was already on the current release, so its next
  // `upgrade` takes the up-to-date early return — a prune only on the applied
  // path would never reach it.
  const dir = await Deno.makeTempDir({ prefix: "specnaut-stale-staging-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    await seedStaleStaging(dir);

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
    assertStringIncludes(up.stdout, "already up to date");

    for (const rel of Object.values(STALE)) {
      assert(!(await stagedOnDisk(dir, rel)), `${rel} is stale and must be pruned by upgrade`);
    }
    assert(
      !(await stagedOnDisk(dir, "")),
      "an emptied staging directory is removed, like `reconcile` removes it",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a dry run prunes nothing either", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-stale-staging-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    await seedStaleStaging(dir);

    const dry = await runSpecnaut(["upgrade", "--dry-run"], dir);
    assertEquals(dry.code, 0, `dry-run failed: ${dry.stderr}`);

    for (const rel of Object.values(STALE)) {
      assert(await stagedOnDisk(dir, rel), `a preview must not delete ${rel}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("reconcile --status lists only paths reconcile <path> can resolve", async () => {
  // No second upgrade here: this is the state the reporter was left in, and
  // the listing has to be honest about it without asking them to run anything.
  const dir = await customizedProject();
  try {
    assertEquals((await runSpecnaut(["upgrade"], dir)).code, 0);
    await seedStaleStaging(dir);

    const listed = await pending(dir);
    assert(!listed.includes(STALE.retired), "a path with no lock entry cannot be reconciled");
    assert(!listed.includes(STALE.untracked), "an untracked path cannot be reconciled");

    // The property the listing owes its reader: every path it names resolves.
    for (const rel of listed) {
      const r = await runSpecnaut(["reconcile", rel, "--accept-current"], dir);
      assertEquals(r.code, 0, `${rel} was listed but reconcile refused it: ${r.stderr}`);
    }
    assertEquals(await pending(dir), [], "the queue must be emptiable");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
