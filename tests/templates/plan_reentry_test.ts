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
      "the item is open and `wip-audit.sh` classed it `IDLE`, `ACTIVE` or `LANDED`",
      "which says whose class an epic's child takes — its own open state governs either way",
      "an open item whose work landed has more to do",
      "Closed or a non-zero exit runs alone",
      "`UNPUSHED` lists `origin/<base>..<base>` and stops",
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

/** spec 056 (cli#730) — a cloud re-entry continues on the item's branch: only the cloud render says how. */
const CLOUD_PLAN = [
  // cli#735: one rule per question — the epic's class picks the branch, the child's state the run.
  "for a child, `<task>` below is its parent epic, and the epic's class picks the branch. Only one thing is the child's own: open chains, closed runs alone (`phases/auto-chain.md`).",
  "Read the epic's creation time from its own `view.sh` and run `wip-audit.sh <task>@<epoch>`",
  // cli#732: an IDLE child of an ACTIVE epic continues on the epic's branch, never a stop at implement.
  "So an `IDLE` child of an `ACTIVE` epic continues on the epic's branch.",
  // cli#732: the stale-cache fallback is read by its exit code, never by its warning text.
  "Any non-zero exit stops here — exit 6 too, Cloud unreachable and an older cache reused",
  "`IDLE` with a plan: one that stopped on a question. It is an adopted plan; skip step 2.",
  "`ACTIVE`: adopt `<task>`'s branch as `resume.md` § 1 item 4 and § 3 do; a failed check stops and names it. It is an adopted plan; skip step 2.",
  "A plan changed since it was approved, by `implement`'s `plan_blob` rule, is an open question at step 7.",
  "It runs once, before the run ends or hands off: here, or at step 7 when the plan stops on a question there.",
  "A non-zero push is a stop, before anything is invoked.",
  "On an adopted plan, step 8 pushes only when something changed.",
  "A plan exists when it materialises `.specnaut/specs/.cache/<task>/1-plan.md`",
  "do **NOT** write `.specnaut/feature.json`",
  "`specnaut spec push <task>` sends the plan with its audits and answers",
  "`IDLE` with no plan, or `LANDED` with the item open: a new plan, or the next slice. Step 2 runs.",
  // cli#733: one rule for a child — the epic's class, the item's own open state — in plan and auto-chain.
  "`LANDED` with the item closed: a plan that runs alone (`phases/auto-chain.md`). Step 2 runs.",
  "Only one thing is the child's own: open chains, closed runs alone (`phases/auto-chain.md`).",
  "`no spec for task`, or no such file, means none does",
  "The task is the item's id: `plan <id>`, or `--issue <N>`. With no item, the product-owner creates one first",
  "Stopping here on a question: push first, as step 8's cloud block says.",
  // Step 8's record of the approved plan: without it, a re-approved plan stops at implement forever.
  "When Re-entry adopted a branch, record the plan now approved",
  "`specnaut spec pull <task>` again, a non-zero exit a stop; when `git hash-object .specnaut/specs/.cache/<task>/1-plan.md` is not `feature.json`'s `plan_blob`, set it",
  'git commit -m "plan(<task>): the approved plan"',
];
/** Text the cloud render must not carry: the removed base-dirtying step, the false auto-create, the local branch. */
const NOT_IN_CLOUD_PLAN = [
  "Persist `{",
  "auto-creates",
  "create-new-feature.sh --json --short-name",
  "git add .specnaut/specs/<feature-dir>/ .specnaut/feature.json",
  // cli#732: the stale-cache fallback is keyed on exit 6, not on the warning's words.
  "reusing the existing cache",
];
const CLOUD_IMPLEMENT = [
  "`bash .specnaut/scripts/bash/wip-audit.sh <task>@<epoch>`; a non-zero exit stops",
  "`ACTIVE <task> <sha>`, HEAD's tip is `<sha>`, and HEAD's branch passes `resume.md` § 3: continue on it",
  "A re-entry creates no second branch.",
  "the plan changed since it was approved: stop and say so — `/task plan <task>` re-approves it",
  "when `wip-audit.sh` (below) prints `ACTIVE` for it at HEAD's tip — a link HEAD's own commits set, never one inherited from the base; otherwise stop and ask for it",
  "the whole-number `linked_issue` of HEAD's committed",
  "For an epic's child it is the epic, and `<epoch>` is `<task>`'s creation time.",
  "anything but a materialised `1-plan.md` stops",
  "anything already staged (`git diff --cached --quiet` fails) is a stop",
  "`ACTIVE` anywhere else: stop and name the sha, never a branch name",
  "`UNPUSHED`: stop; that push is `merge`'s recovery.",
  "HEAD is the base, or its branch passes `resume.md` § 3 check 5; otherwise stop and name HEAD's sha",
  "--branch-only --issue <task>",
  '"plan_blob": "<git hash-object of the pulled 1-plan.md>"',
  'git commit --allow-empty -m "plan(<task>): link the branch to its task"',
];

Deno.test("the cloud render carries the cloud re-entry and implement rules, and none of the local ones; the local render none of the cloud's", () => {
  let cloud = 0;
  for (const h of HARNESSES) {
    for (const opts of everyBundleOption()) {
      const files = Object.values(h.mapBundle(CORE_BUNDLE, opts));
      const tag = `${h.key}/${JSON.stringify(opts)}`;
      const plan = files.find((f) => (f.content ?? "").includes("**Re-entry.**"));
      const impl = files.find((f) => (f.content ?? "").includes("**Done is the brief's checks.**"));
      assert(plan && impl, `${tag}: no plan or implement document`);
      const isCloud = opts.specBackend === "cloud";
      if (isCloud) cloud++;
      for (const [doc, want] of [[plan, CLOUD_PLAN], [impl, CLOUD_IMPLEMENT]] as const) {
        for (const s of want) {
          assertEquals(flat(doc.content!).includes(s), isCloud, `${tag}: ${s}`);
        }
      }
      for (const s of NOT_IN_CLOUD_PLAN) {
        if (isCloud) assert(!flat(plan.content!).includes(s), `${tag}: cloud carries ${s}`);
      }
    }
  }
  assert(cloud > 0, "no cloud option set was rendered");
});

Deno.test("cloud plan pushes once, at step 8, after the audits and answers it carries", () => {
  let n = 0;
  for (const h of HARNESSES) {
    for (const opts of everyBundleOption().filter((o) => o.specBackend === "cloud")) {
      n++;
      const files = Object.values(h.mapBundle(CORE_BUNDLE, opts));
      const plan = flat(files.find((f) => (f.content ?? "").includes("**Re-entry.**"))!.content!);
      const tag = `${h.key}/${JSON.stringify(opts)}`;
      // Every spelling of the command, less the one sentence that only names it.
      const named = "`specnaut spec push` needs a task number";
      const pushes = [...plan.replace(named, "_".repeat(named.length)).matchAll(/spec push/g)].map((
        m,
      ) => m.index!);
      assertStringIncludes(plan, named, tag);
      assertEquals(pushes.length, 1, `${tag}: one push`);
      const step7 = plan.search(/#+ 7\. /), step8 = plan.search(/#+ 8\. /);
      assert(step7 > 0 && step8 > step7, `${tag}: steps 7 and 8`);
      assert(pushes[0] > step8, `${tag}: the push comes before the plan is done`);
    }
  }
  assert(n > 0, "no cloud option set was rendered");
});

Deno.test("spec-autogen's cloud plan ends with its push and invokes nothing after it", () => {
  assertStringIncludes(
    flat(read("skills/task/spec-autogen.md")),
    "The flow ends with its push, at the plan stop or step 8, and invokes nothing after it.",
  );
});

Deno.test("cloud review stops on spec pull's stale-cache exit, as plan and implement do (cli#732)", () => {
  let n = 0;
  for (const h of HARNESSES) {
    for (const opts of everyBundleOption().filter((o) => o.specBackend === "cloud")) {
      n++;
      const files = Object.values(h.mapBundle(CORE_BUNDLE, opts));
      const review = files.find((f) =>
        (f.content ?? "").includes("**Materialise the spec (cloud backend):**")
      );
      const tag = `${h.key}/${JSON.stringify(opts)}`;
      assert(review, `${tag}: no cloud review document`);
      assertStringIncludes(
        flat(review.content!),
        "A non-zero exit stops with its message — exit 6 too, Cloud unreachable and an older cache reused",
        tag,
      );
    }
  }
  assert(n > 0, "no cloud option set was rendered");
});
