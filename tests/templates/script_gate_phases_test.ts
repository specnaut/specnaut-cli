import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CONFIG_INPUTS } from "../../src/domain/config_trust.ts";
import { flat } from "./task_docs.ts";

/**
 * The helper-script gate outside review and merge: resume, groom, the backlog verbs and audit run
 * it before their first script of the tree, with the review's wording, and every config class the
 * verifier judges has a row saying what its untrusted line means, read where the input is read.
 */

const read = (rel: string) =>
  Deno.readTextFileSync(new URL(`../../templates/core/skills/task/${rel}`, import.meta.url));
const gate = () => read("phases/script-gate.md");

Deno.test("the gate block verifies first and words a refusal as the review does", () => {
  const g = gate();
  const block = g.split("<!-- script-gate: verify-scripts -->")[1];
  assert(block !== undefined, "script-gate.md lost its anchor");
  assert(block.indexOf("specnaut verify-scripts") < block.indexOf("SCRIPTS TRUSTED"));
  const review = read("phases/review.md");
  for (
    const line of [
      '[ "$last" = "VERDICT scripts trusted" ]',
      "SCRIPTS NOT RUN: verify-scripts exit $rc",
    ]
  ) {
    assertStringIncludes(block, line);
    assertStringIncludes(review, line);
  }
  assertStringIncludes(flat(g), "Never fall back to a script of the tree");
});

Deno.test("the router sends resume, groom, the backlog verbs and audit through the gate", () => {
  const routing = flat(read("SKILL.md"));
  assertStringIncludes(
    routing,
    "For `resume`, `groom`, `audit` and every verb of `backlog.md`, also read " +
      "`phases/script-gate.md` and run its gate before the verb's first script of the tree",
  );
  assertStringIncludes(
    routing,
    "| `phases/script-gate.md` | `resume`, `groom`, `audit` and the backlog verbs",
  );
});

Deno.test("resume runs the gate before its first script, and reads its link only under it", () => {
  const r = read("resume.md");
  const at = r.indexOf("phases/script-gate.md");
  assert(at >= 0 && at < r.indexOf("view.sh") && at < r.indexOf("wip-audit.sh"));
  assertStringIncludes(
    flat(r),
    "Read it only when the gate printed `VERDICT linked-issue trusted`",
  );
});

Deno.test("audit runs the gate before the map and the scope, and takes --diff's base from it", () => {
  const a = read("phases/audit.md");
  const at = a.indexOf("phases/script-gate.md");
  assert(
    at >= 0 && at < a.indexOf("specnaut scan --format") && at < a.indexOf("collect-audit-scope.sh"),
  );
  assert(!a.includes("git-read.sh base"), "audit.md still reads its base from the tree");
  assertStringIncludes(flat(a), "`VERDICT size-limits trusted` for the map below to run");
});

Deno.test("every config class has a row in the gate doc", () => {
  const g = gate();
  for (const input of CONFIG_INPUTS) assertStringIncludes(g, `| \`${input.class}\` |`);
});

/** What names a class's input or its reader in a task doc. */
const NAMED_BY: Record<string, readonly string[]> = {
  "workflow": ["workflow.yml", "merge-mode.sh"],
  "size-limits": ["size-limits.yml", "size-ratchet.sh", "specnaut scan"],
  "boundaries": ["boundaries.yml", "boundary-check.sh"],
  "backlog-config": ["backlog-config.yml"],
  "linked-issue": ["linked_issue", "feature.json` links"],
  "gates": ["gates.yml", "run-gate.sh"],
};

/**
 * Where a task doc names an input and need not name its verdict, and why. Every entry is a doc and a
 * class; a section of any other doc that names the input must name `VERDICT <class> trusted`.
 */
const NOT_A_GATED_READER: Record<string, string> = {
  "SKILL.md workflow": "the router describes the merge mode; auto-chain.md reads it",
  "backlog.md backlog-config": "setting the file up; the router gates the verbs that read it",
  "phases/constitution.md size-limits": "the verb that edits the gate configs, never reads them",
  "phases/constitution.md boundaries": "the verb that edits the gate configs, never reads them",
  "phases/plan.md linked-issue": "plan writes the link",
  "phases/plan.md gates": "plan names the gate a requirement maps to, and runs none",
  "phases/implement.md linked-issue": "implement writes the link, under no gate",
  "phases/epic-loop.md gates": "implement's loop, under no gate",
  "phases/script-gate.md workflow": "the table that defines the rule",
  "phases/script-gate.md size-limits": "the table that defines the rule",
  "phases/script-gate.md boundaries": "the table that defines the rule",
  "phases/script-gate.md backlog-config": "the table that defines the rule",
  "phases/script-gate.md linked-issue": "the table that defines the rule",
  "phases/script-gate.md gates": "the table that defines the rule",
  "phases/quality-gates.md gates": "its header holds the rule for every section on gates.yml",
  "resume.md linked-issue": "§ 3 reads a branch's committed link, from git, not the tree",
  "phases/auto-chain.md backlog-config": "the intake gate's fence question names the file",
};

/** A doc split at its `##` and `###` headings. */
const sections = (text: string) => text.split(/^#{2,3} /m);

Deno.test("every section of a task doc that reads a class's input names its trusted line", () => {
  const docs = [...Deno.readDirSync(new URL("../../templates/core/skills/task/", import.meta.url))]
    .filter((e) => e.isFile && e.name.endsWith(".md")).map((e) => e.name)
    .concat(
      [...Deno.readDirSync(new URL("../../templates/core/skills/task/phases/", import.meta.url))]
        .filter((e) => e.name.endsWith(".md")).map((e) => `phases/${e.name}`),
    );
  const misses: string[] = [];
  for (const doc of docs) {
    for (const input of CONFIG_INPUTS) {
      if (NOT_A_GATED_READER[`${doc} ${input.class}`]) continue;
      for (const section of sections(read(doc))) {
        const names = NAMED_BY[input.class].some((t) => section.includes(t));
        const verdict = flat(section).includes(`VERDICT ${input.class} trusted`);
        if (names && !verdict) misses.push(`${doc} ${input.class}: ${section.split("\n")[0]}`);
      }
    }
  }
  assertEquals(misses, []);
});

Deno.test("a backlog-config line not trusted makes the merge manual, and keeps remote mode on", () => {
  const a = flat(read("phases/auto-chain.md"));
  assertStringIncludes(
    a,
    "unless the gate printed both `VERDICT workflow trusted` and `VERDICT backlog-config trusted`",
  );
  assertStringIncludes(a, "when the tree or the base tip's copy turns it on");
  assertStringIncludes(a, "a copy that does not parse never turns it off");
  assertStringIncludes(
    a,
    "On, and the gate did not print `VERDICT backlog-config trusted`: stop on the branch, nothing lands.",
  );
});

Deno.test("merge settles a link the branch wrote only for the id the run was given", () => {
  const m = flat(read("phases/merge.md"));
  assertStringIncludes(m, "the id the chain started with, or the one `/task merge <id>` names");
  assertStringIncludes(m, "With no such id, or any other `linked-issue` line, it settles nothing");
});

Deno.test("an untrusted instructions line makes merge step 0 manual, shows the diff, asks once", () => {
  const m = flat(read("phases/merge.md"));
  const rule = m.slice(m.indexOf("Unless the last run printed `VERDICT instructions trusted`"));
  assert(rule.length < m.length, "merge.md step 0 has no rule for the instructions line");
  const said = rule.slice(0, rule.indexOf(" read.") + 6);
  assertStringIncludes(
    said,
    "Unless the last run printed `VERDICT instructions trusted`, or only `instructions` lines " +
      "reading `behind base: rebase` (rebased as above), this run's merge mode is `manual`: a " +
      "missing `instructions` line is an untrusted one.",
  );
  assertStringIncludes(said, "`git diff <BASE_TIP> -- <path>`");
  assertStringIncludes(said, "ask once");
  assertStringIncludes(said, "The session read `AGENTS.md` before this step ran");
  assert(m.indexOf(rule) < m.indexOf("1. **Shape the history.**"), "the rule is not in step 0");
  assertStringIncludes(flat(gate()), "| `instructions` |");
  assertStringIncludes(
    flat(read("phases/auto-chain.md")),
    "unless it printed `VERDICT instructions trusted`, or only `instructions` lines reading " +
      "`behind base: rebase`: a missing `instructions` line is an untrusted one",
  );
});
