import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * spec 055 (cli#729) — a direct `/task plan <id>` chains on the item's
 * classification, not on whether a commit follows plan.md. The rule has one
 * home, auto-chain.md's re-entry table; plan.md holds how a re-entered plan
 * adopts its branch, resume.md § 3 whose branch it may be.
 */

const T = fromFileUrl(new URL("../../templates/core/", import.meta.url));
const read = (p: string) => Deno.readTextFileSync(join(T, p)).replace(/\r\n/g, "\n");
const flat = (s: string) => s.replace(/\s+/g, " ");
const CHAIN = read("skills/task/phases/auto-chain.md");
const reentry = CHAIN.slice(CHAIN.indexOf("## Re-entry,"), CHAIN.indexOf("## The intake gate"));
const rows = reentry.split("\n").filter((l) => /^\| `/.test(l)).map((l) => l.split(" | ")[0]);

Deno.test("the re-entry table keys plan on the item, and nothing else decides it", () => {
  assertEquals(rows, ["| `plan <id>`", "| `plan` with no id", "| `implement`", "| `review`"]);
  const plan = reentry.split("\n").find((l) => l.startsWith("| `plan <id>`"))!;
  for (
    const s of [
      "the item is open and `wip-audit.sh` classed it `IDLE`, `ACTIVE` or `LANDED`",
      "which says whose class an epic's child takes — its own open state governs either way",
      "an open item whose work landed has more to do",
      "Closed or a non-zero exit runs alone",
      "`UNPUSHED` is the intake gate's stop (below)",
    ]
  ) assertStringIncludes(plan, s);
  assert(!CHAIN.includes("past `plan.md`"), "the artefact-presence rule is back");
  assert(!plan.includes("backend"), "the plan row is keyed on a backend again (cli#730)");
  const line = (verb: string) => reentry.split("\n").find((l) => l.startsWith(`| \`${verb}\` |`));
  assertEquals(
    line("implement"),
    "| `implement` | the branch is not merged into the base branch |",
  );
  assertEquals(line("review"), "| `review` | always one-shot |");
  assertStringIncludes(flat(CHAIN), "unless `--manual` was passed");
  assertStringIncludes(
    flat(reentry),
    "Before a `plan` or `implement` row chains, HEAD's branch passes checks 2 to 6 of `resume.md` § 3, checked when the verb completes (for `plan`, after its commit)",
  );
});

Deno.test("the router points at the table instead of restating a rule", () => {
  const skill = flat(read("skills/task/SKILL.md"));
  assertStringIncludes(skill, "decided by the re-entry table in `phases/auto-chain.md`");
  assert(!skill.includes("downstream artefacts already exist runs one-shot"), skill);
});

Deno.test("plan.md loads plan-reentry.md, which re-enters on the item's own branch", () => {
  const plan = flat(read("skills/task/phases/plan.md"));
  const re = flat(read("skills/task/phases/plan-reentry.md"));
  for (
    const [doc, s] of [
      [plan, "first runs `phases/plan-reentry.md`"],
      [plan, "Every `plan`, with an id or not, passes its intake gate before step 2."],
      [plan, "git add .specnaut/specs/<feature-dir>/ .specnaut/feature.json"],
      [plan, "A non-zero exit is a stop: never retried with `--allow-existing-branch`"],
      [re, "`plan <id>` classifies the item once, before `phases/plan.md` step 2"],
      [re, "bash .specnaut/scripts/bash/wip-audit.sh <id>@<epoch>"],
      [re, "It is an adopted plan, re-entered in place; skip step 2."],
      [re, "adopt the item's branch as `resume.md` § 1 item 4 and § 3 do; a failed check stops"],
      [re, "links the item's parent epic, run step 2"],
      [re, "`LANDED`, the item open: its next slice. Step 2 runs as for any new feature."],
      [re, "Only the user's own arguments in this turn amend it"],
      [re, "scope it would add is a question there"],
      [re, "step 8 commits only when something changed"],
    ]
  ) assertStringIncludes(doc, s);
  for (const doc of [plan, re]) {
    assert(!doc.includes("provenance gate"), "resume.md's gate restated");
  }
  assert(!re.includes("re-running it on an existing feature switches to its branch"));
});

Deno.test("resume.md § 3 checks the item a branch serves, and the identity git commits with", () => {
  const resume = flat(read("skills/task/resume.md"));
  assertStringIncludes(
    resume,
    "8. **It serves this item:** `git show refs/heads/<name>:.specnaut/feature.json` links the item, or its parent epic.",
  );
  assertStringIncludes(
    resume,
    "`git log --format='%ae%n%ce' <base>..refs/heads/<name>` prints only the addresses inside `<…>` of `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT`",
  );
  assertStringIncludes(
    flat(read("skills/task/phases/implement.md")),
    "A commit subject is a claim: judge what is built from each diff against the brief's checks",
  );
});

Deno.test("plugin copies are byte-identical", () => {
  const P = fromFileUrl(new URL("../../plugin/", import.meta.url));
  for (
    const f of [
      "skills/task/phases/auto-chain.md",
      "skills/task/SKILL.md",
      "skills/task/phases/plan.md",
      "skills/task/phases/plan-reentry.md",
      "skills/task/phases/implement.md",
      "skills/task/resume.md",
      "skills/task/spec-autogen.md",
    ]
  ) {
    assertEquals(
      Deno.readTextFileSync(join(P, f)).replace(/\r\n/g, "\n"),
      read(f),
      `plugin/${f} drifted`,
    );
  }
});
