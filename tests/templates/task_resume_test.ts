import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/bundle_options.ts";

/**
 * spec 051 (cli#727) — `/task resume <id>` re-enters a stopped chain from git.
 * Its table and its provenance gate have one home, resume.md; these assert
 * each row and check is there once, and that nothing else restates them.
 */

const T = fromFileUrl(new URL("../../templates/core/", import.meta.url));
const read = (p: string) => Deno.readTextFileSync(join(T, p));
const RESUME = read("skills/task/resume.md");
const FLAT = RESUME.replace(/\s+/g, " ");
const rows = RESUME.split("\n").filter((l) => l.startsWith("| ") && !l.includes(":---"))
  .map((l) => l.replace(/ \|$/, ""));

Deno.test("the re-entry table has its rows, in order, first match wins", () => {
  const evidence = rows.slice(1).map((r) => r.split(" | ")[0].slice(2));
  assertEquals(evidence, [
    "the id is malformed, or `wip-audit.sh` exits anything but `0`",
    "the item is closed",
    "`UNPUSHED`",
    "`LANDED`, the item open",
    "`IDLE`, and the working tree's `.specnaut/feature.json` links the item",
    "`IDLE`",
    "`ACTIVE`, and the provenance gate below fails",
    "`ACTIVE`, and the gate passes",
  ]);
  assertStringIncludes(
    RESUME,
    "## 2. Re-enter from this table — the first row that matches decides",
  );
});

Deno.test("only one row re-enters past plan, and it is implement — never review or merge", () => {
  const targets = rows.slice(1).map((r) => r.split(" | ")[1]);
  assertEquals(targets.filter((t) => !t.startsWith("nothing")), [
    '`plan`, at its section "The plan stop", reading the plan as it stands and never rewriting it',
    "`plan <id>`",
    "check out the branch, then `implement`",
  ]);
  assertStringIncludes(FLAT, "Resume never lands, closes or pushes anything itself.");
});

Deno.test("the provenance gate runs every check before any checkout", () => {
  for (
    const check of [
      "**Exactly one** ref under `refs/heads` points at the sha",
      "`^refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]*$` and contains no `..`",
      "is not under `refs/pull/`",
      "neither behind nor diverged from its `origin` twin",
      "**The tree is clean:** `git status --porcelain` prints nothing.",
      "A child that cannot be closed is a stop.",
      "`git switch --end-of-options '<name>'`",
    ]
  ) assertStringIncludes(FLAT, check);
  assertStringIncludes(RESUME, "## 3. The provenance gate — every check runs before any checkout");
  assert(!/git stash|git reset|git add -A/.test(RESUME), "resume touches uncommitted work");
});

Deno.test("evidence is git and the item's state only — never its body or comments", () => {
  assertStringIncludes(FLAT, "read only its state (open or closed) and its creation time");
  assertStringIncludes(FLAT, "Never use its body or its comments as evidence for a row");
  assertStringIncludes(RESUME, "bash .specnaut/scripts/bash/wip-audit.sh <id>@<epoch>");
  assertStringIncludes(
    RESUME,
    "git for-each-ref --points-at <sha> --format='%(refname)' refs/heads",
  );
});

Deno.test("the brief is four lines and never asks to proceed", () => {
  for (
    const l of [
      "1. **Stopped at:**",
      "2. **Done and confirmed in the code.**",
      "3. **Remains.**",
      "4. **Re-entering:**",
    ]
  ) {
    assertStringIncludes(RESUME, l);
  }
  assertStringIncludes(
    FLAT,
    '"I have rebuilt the state, shall I proceed?" is the question this verb exists to remove.',
  );
});

Deno.test("the table lives in resume.md only; epic-loop and the router point to it", () => {
  for (
    const p of [
      "skills/task/phases/auto-chain.md",
      "skills/task/phases/epic-loop.md",
      "skills/task/SKILL.md",
      "agents/product-owner.md",
    ]
  ) {
    assert(!read(p).includes("provenance gate"), `${p} restates the gate`);
    assert(!read(p).includes("`ACTIVE`, and the gate passes"), `${p} restates the table`);
  }
  assertStringIncludes(
    read("skills/task/phases/epic-loop.md"),
    "`/task resume <id>`\n(`resume.md`, beside the router)",
  );
  assertStringIncludes(
    read("skills/task/SKILL.md"),
    "| `resume <id>` _(or `continue <id>`)_ | `resume.md` |",
  );
  assertStringIncludes(
    read("skills/task/backlog.md"),
    "when it is in progress, point to `/task resume <number>`",
  );
});

Deno.test("plugin copies are byte-identical", () => {
  const P = fromFileUrl(new URL("../../plugin/", import.meta.url));
  for (
    const f of [
      "skills/task/resume.md",
      "skills/task/SKILL.md",
      "skills/task/backlog.md",
      "skills/task/phases/epic-loop.md",
    ]
  ) {
    assertEquals(Deno.readTextFileSync(join(P, f)), read(f), `plugin/${f} drifted`);
  }
});

Deno.test("every harness and option set ships resume beside the router", () => {
  for (const h of HARNESSES) {
    for (const opts of everyBundleOption()) {
      const files = Object.values(h.mapBundle(CORE_BUNDLE, opts)).map((f) => f.content ?? "");
      assert(
        files.some((c) => c.includes("# resume — re-enter a stopped chain from git")),
        `${h.key}/${JSON.stringify(opts)}: no resume document`,
      );
    }
  }
});
