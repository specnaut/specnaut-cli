import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/bundle_options.ts";

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
const reentry = CHAIN.slice(CHAIN.indexOf("## Re-entry, without a flag"));
const rows = reentry.split("\n").filter((l) => /^\| `/.test(l)).map((l) => l.split(" | ")[0]);

Deno.test("the re-entry table keys plan on the item, and nothing else decides it", () => {
  assertEquals(rows, ["| `plan <id>`", "| `plan` with no id", "| `implement`", "| `review`"]);
  const plan = reentry.split("\n").find((l) => l.startsWith("| `plan <id>`"))!;
  for (
    const s of [
      "the item is open and `wip-audit.sh` classed it `IDLE`, `LANDED` or, on the local backend, `ACTIVE`",
      "an open item whose work landed has more to do",
      "Closed or a non-zero exit runs alone",
      "`UNPUSHED` lists `origin/<base>..<base>` and stops",
    ]
  ) assertStringIncludes(plan, s);
  assert(!CHAIN.includes("past `plan.md`"), "the artefact-presence rule is back");
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

Deno.test("plan.md re-enters on the item's own branch, amended only by the user", () => {
  const plan = flat(read("skills/task/phases/plan.md"));
  for (
    const s of [
      "`plan <id>` classifies the item once, before step 2",
      "where its row stops (`UNPUSHED`), stop here, before step 2",
      "bash .specnaut/scripts/bash/wip-audit.sh <id>@<epoch>",
      "It is an adopted plan, re-entered in place; skip step 2.",
      "adopt the item's branch as `resume.md` § 1 item 4 and § 3 do; a failed check stops",
      "links the item's parent epic, run step 2",
      "`LANDED`, the item open: its next slice. Step 2 runs as for any new feature.",
      "Only the user's own arguments in this turn amend it",
      "scope it would add is a question there",
      "step 8 commits only when something changed",
      "git add .specnaut/specs/<feature-dir>/ .specnaut/feature.json",
      "A non-zero exit is a stop: never retried with `--allow-existing-branch`",
    ]
  ) assertStringIncludes(plan, s);
  assert(!plan.includes("re-running it on an existing feature switches to its branch"));
  assert(!plan.includes("provenance gate"), "plan.md restates resume.md's gate");
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
      "skills/task/phases/implement.md",
      "skills/task/resume.md",
    ]
  ) {
    assertEquals(
      Deno.readTextFileSync(join(P, f)).replace(/\r\n/g, "\n"),
      read(f),
      `plugin/${f} drifted`,
    );
  }
});

Deno.test("every harness and option set ships the same plan row, gate and Re-entry paragraph", () => {
  const want = reentry.split("\n").find((l) => l.startsWith("| `plan <id>`"))!;
  const gate = "HEAD's branch passes checks 2 to 6 of `resume.md` § 3";
  // The paragraph's backend-neutral sentences: each install renders its spec-backend blocks away.
  const para = [
    "`plan <id>` classifies the item once, before step 2",
    "bash .specnaut/scripts/bash/wip-audit.sh <id>@<epoch>",
    "where its row stops (`UNPUSHED`), stop here, before step 2",
    "Only the user's own arguments in this turn amend it",
  ];
  for (const h of HARNESSES) {
    for (const opts of everyBundleOption()) {
      const files = Object.values(h.mapBundle(CORE_BUNDLE, opts));
      const chain = files.find((f) => (f.content ?? "").includes("## Re-entry, without a flag"));
      const tag = `${h.key}/${JSON.stringify(opts)}`;
      assert(chain, `${tag}: no auto-chain document`);
      assertStringIncludes(chain.content!.replace(/\r\n/g, "\n"), want, tag);
      assertStringIncludes(flat(chain.content!), gate, tag);
      const doc = files.find((f) => (f.content ?? "").includes("**Re-entry.**"));
      assert(doc, `${tag}: no plan document with its Re-entry paragraph`);
      for (const sentence of para) assertStringIncludes(flat(doc.content!), sentence, tag);
    }
  }
});
