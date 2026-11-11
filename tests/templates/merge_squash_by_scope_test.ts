import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "../scripts/git_sandbox.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * #459 — squash BY SCOPE at merge, not one commit per branch.
 *
 * The squash itself is the agent's: `phases/merge-squash.md` tells it how, and
 * no script runs it. What a script decides is asserted by running it in a git
 * sandbox (cli#716): `land-feature.sh` lands the scope commits exactly as the
 * squash left them, and refuses to land over what the squash left behind. A
 * doc rewording cannot break those, and a script that decides differently
 * cannot get past them.
 *
 * What is left is instruction with no script behind it. It is kept as text,
 * one anchor per rule, each with the reason no run can observe it.
 */

function phase(name: string): CoreEntry {
  const e = CORE_BUNDLE.find((x) => x.category === "phase" && skillDocName(x) === name);
  if (!e) throw new Error(`missing ${name} phase entry`);
  return e;
}

/** A feature branch shaped the way the squash leaves it: one commit per scope. */
const SCOPES = [
  "feat(7): the feature, its domain and its tests",
  "chore(codegen): regenerate the bundle the feature invalidated",
  "fix(8): the pre-existing defect the branch exposed, under its own id",
  "docs(7): the guide written alongside",
];

Deno.test("a branch squashed by scope lands as those commits, in order, its tree byte-identical", async () => {
  const sb = await sandbox();
  try {
    const base = await git(sb.work, "rev-parse", "HEAD");
    await git(sb.work, "switch", "--quiet", "-c", "007-x");
    for (const [i, subject] of SCOPES.entries()) await sb.commit(`f${i}`, `${i}\n`, subject);
    const tree = await git(sb.work, "rev-parse", "HEAD^{tree}");
    const r = await sb.script("land-feature.sh");
    // One record, so a script that decides differently shows every field it moved.
    assertEquals(
      {
        landed: (await git(sb.remote, "log", "--reverse", "--format=%s", `${base}..main`)).split(
          "\n",
        ),
        tree: await git(sb.remote, "rev-parse", "main^{tree}"),
        line: /^LANDED main [0-9a-f]{12}\.\.[0-9a-f]{12} (\d+) commit\(s\)$/m.exec(r.stdout)?.[1],
        code: r.code,
      },
      { landed: SCOPES, tree, line: String(SCOPES.length), code: 0 },
      r.stderr,
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("generated output the squash left untracked refuses the landing: exit 4, nothing pushed", async () => {
  // merge-squash.md: an untracked file is classified, never reported over. The
  // landing is where "reported over" would happen, so it must count `??` too.
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "007-x");
    await sb.commit("f", "x\n", SCOPES[0]);
    const before = await git(sb.remote, "rev-parse", "main");
    await Deno.writeTextFile(join(sb.work, "bundle.gen.js"), "generated\n");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 4, r.stderr);
    assertStringIncludes(r.stderr, "?? bundle.gen.js");
    assertEquals(await git(sb.remote, "rev-parse", "main"), before, "origin moved");
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "007-x");
  } finally {
    await sb.cleanup();
  }
});

// A merge ends on the base branch, the branch gone and origin level: that is
// land_feature_test's first test, run (cli#711). Its refusals hold force-pushing
// and force-deleting absent: exit 7 (a rejected push stays rejected) and 11 (a
// branch that will not delete). Its exit-table test holds that each exit has a
// row in merge.md, not what the row says: that is instruction, below.

/**
 * [doc, anchor, why no run can observe it]. Not here, because a run proves
 * them: the refused push itself (land_feature_test's exit 7), the epic that is
 * not squashed (epic_status_test's 0 and 14), and the close (merge-close.md's
 * routing, and close_shipped_test). The scaffolded docs' own routing is
 * smoke-merge.sh's.
 */
const INSTRUCTION: ReadonlyArray<readonly [string, string, string]> = [
  ["merge", "phases/merge-squash.md", "which doc the agent loads: no script reads it"],
  ["merge-squash", "one commit per scope", "the grouping is the agent's; a landing keeps any"],
  ["merge-squash", "never the feature's", "a subject's id is the agent's choice; git takes any"],
  ["merge-squash", "Never `git add -A`", "how the agent stages: no script stages for it"],
  ["merge-squash", "byte-identical", "the agent's own diff, before and after; nothing records it"],
  ["merge-squash", "Do not stop between steps 2 and 3", "a prompt the agent must not raise"],
  ["merge-squash", '"Squash and merge"', "a forge button no script can press"],
  [
    "merge-squash",
    "Its own `chore(codegen):` commit",
    "the scope table routes; no script classifies",
  ],
  ["merge-squash", "in the scope position", "where the id goes is the agent's; git takes any"],
  ["merge-squash", "**those files only**", "the one halt's reach; no script bounds a prompt"],
  ["merge-squash", "base branch is **protected**", "choosing --pr; a refused push only fails safe"],
  ["merge", "the landing stands: step 5 runs", "what the agent does on 11: the script only exits"],
  ["merge", "the person who asked must be back where they work", "the agent's checkout on 9"],
  ["merge", "A rule refused it (protected base, hook): run step 5", "the agent's move on 7"],
  [
    "merge-close",
    "Children first, the epic last.",
    "the order the agent passes; the script keeps any",
  ],
];

Deno.test("the squash rules no script runs are still the agent's instruction", () => {
  const missing = INSTRUCTION.filter(([doc, anchor]) => !phase(doc).content.includes(anchor))
    .map(([doc, anchor, why]) => `${doc}.md lost "${anchor}" (${why})`);
  assertEquals(missing, []);
});

// #677 — epic-status.sh reads <base>..HEAD. After land-feature.sh fast-forwards
// the base that range is empty (exit 14: "not an epic"), so the children to
// close are read before the landing and kept, never re-read after it. The
// script's half runs in epic_status_test (14 after the fast-forward, 16 when
// feature.json names an epic); the order the agent calls the two scripts in is
// instruction, and only the doc holds it.
Deno.test("the epic is read in a step before the landing, and the close never re-reads it", () => {
  const { content } = phase("merge");
  // Every occurrence, not the first: a second epic-status.sh call after the
  // landing would read the empty range, and a first-match check passes it (cli#711).
  const stepsOf = (needle: string) => {
    const steps: number[] = [];
    for (let at = content.indexOf(needle); at >= 0; at = content.indexOf(needle, at + 1)) {
      const heads = [...content.slice(0, at).matchAll(/^(\d+)\. \*\*/gm)];
      steps.push(Number(heads.at(-1)?.[1]));
    }
    assert(steps.length > 0, `merge.md no longer calls ${needle}`);
    return steps;
  };
  const read = stepsOf("bash .specnaut/scripts/bash/epic-status.sh");
  const land = stepsOf("bash .specnaut/scripts/bash/land-feature.sh");
  // Step 1: the step merge-close.md cites as where the CHILD and EPIC lines come from.
  assert(
    read.every((s) => s === 1) && Math.max(...read) < Math.min(...land),
    `epic-status.sh at steps ${read}, land-feature.sh at ${land}`,
  );
  const close = phase("merge-close").content;
  // Only § Re-entry reads it, and as `--landed`: the published base, never the empty range (cli#760).
  assert(
    !/bash \.specnaut\/scripts\/bash\/epic-status\.sh(?! --landed)/.test(close),
    "merge-close.md re-runs it",
  );
  assertStringIncludes(close, "printed at `phases/merge.md` step 1, before the landing");
});
