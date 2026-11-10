import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs/exists";
import { GH_WRITES, ghIssue, ghProject, jsonl, readThenApply } from "./apply_plan_fixture.ts";
import { ENV_VALUE, HIDDEN_SAMPLES, SECRET_NAMES } from "./secret_samples.ts";

/**
 * The product owner proposes; the bundled executor applies. `apply-plan.sh`
 * checks the whole plan first — schema, the verb's scope, the read it follows,
 * the secret scan — and writes nothing when any check refuses. What it does
 * write reaches `gh` as argv and as body files it wrote itself.
 */

const TOKEN = `ghp_${"a1B2".repeat(9)}`;
// Printable, so the plan's own text rule lets it through to the scan.
const HIDDEN = HIDDEN_SAMPLES.find((s) => s.startsWith("<!--"))!;
const issues = { 7: ghIssue("Export times out", "owner"), 8: ghIssue("Another") };
const EDIT_PLAN = jsonl(
  { op: "comment", target: 7, body: "Which tenant, @owner?" },
  { op: "move", target: 7, status: "Ready" },
  { op: "classify", target: 7, axis: "Priority", value: "P1" },
  { op: "label", target: 7, labels: ["bug"] },
  { op: "edit", target: 7, title: "Export $(touch marker) times out", append: "More detail." },
);

for (const env of [undefined, { LC_ALL: "en_US.UTF-8" }]) {
  Deno.test(`apply-plan: an edit plan reaches gh as argv and body files, its title literally${env ? ", in a UTF-8 locale" : ""}`, async () => {
    const p = await ghProject(issues);
    try {
      const out = await readThenApply(p, ["edit", "--id", "7"], EDIT_PLAN, { env });
      assertEquals(out.code, 0, out.stdout + out.stderr);
      assertEquals(out.lines, [
        "APPLIED comment 7",
        "APPLIED move 7",
        "APPLIED classify 7",
        "APPLIED label 7",
        "APPLIED edit 7",
        "RECEIPT: none",
      ]);
      assertMatch(
        out.calls,
        /^gh\tissue\tcomment\t7\t--repo\tacme\/my-app\t--body-file\t[^\n]+\nBODY\tWhich tenant, @owner\?$/m,
      );
      assertMatch(
        out.calls,
        /^gh\tproject\titem-edit\t--id\tITEM\t--project-id\tPVT\t--field-id\tF2\t--single-select-option-id\tpP1$/m,
      );
      assertStringIncludes(
        out.calls,
        "gh\tissue\tedit\t7\t--repo\tacme/my-app\t--add-label\tbug\n",
      );
      assertStringIncludes(out.calls, "\t--title\tExport $(touch marker) times out\t--body-file\t");
      assertStringIncludes(out.calls, "BODY\tOld body  More detail.\n");
      assert(!(await exists(join(p.dir, "marker"))), "a title ran as a command");
    } finally {
      await p.cleanup();
    }
  });
}

Deno.test("apply-plan: a plan any check refuses writes nothing, and names only the field", async () => {
  const p = await ghProject(issues);
  const cases: [unknown[], RegExp][] = [
    [[{ op: "delete", target: 7 }], /^REFUSED op 1\.op$/m],
    [[{ op: "memory", body: "x" }], /^REFUSED op 1\.op$/m],
    [
      [{ op: "comment", target: 7, body: "x", repo: "acme/other" }],
      /^REFUSED unknown-key 1\.repo$/m,
    ],
    [
      [{ op: "comment", target: 7, body_file: "/etc/hosts" }],
      /^REFUSED unknown-key 1\.body_file$/m,
    ],
    [[{ op: "comment", target: 8, body: "x" }], /^REFUSED scope 1\.target$/m],
    [
      [{ op: "comment", target: "https://github.com/acme/other/issues/7", body: "x" }],
      /^REFUSED scope 1\.target$/m,
    ],
    [
      [{ op: "comment", target: '7){id}} mutation{closeIssue(input:{issueId:"x"})}', body: "x" }],
      /^REFUSED scope 1\.target$/m,
    ],
    [[{ op: "comment", target: "@/etc/hosts", body: "x" }], /^REFUSED scope 1\.target$/m],
    [[{ op: "move", target: 7, status: "Done" }], /^REFUSED status 1\.status$/m],
    [[{ op: "label", target: 7, labels: ["not-a-label"] }], /^REFUSED label 1\.labels$/m],
    [[{ op: "comment", target: 7, body: "cc @someone-else" }], /^REFUSED mention 1\.body$/m],
    [
      [{ op: "comment", target: 7, body: "a" }, { op: "comment", target: 7, body: "b" }],
      /^REFUSED cap 2\.target$/m,
    ],
    [[{ op: "create", title: "New" }], /^REFUSED scope 1\.op$/m],
    [[{ op: "close", target: 7, reason: "completed" }], /^REFUSED scope 1\.op$/m],
    [[{ op: "edit", target: 7, title: "Two\nlines" }], /^REFUSED title 1\.title$/m],
    [[{ op: "edit", target: 7, body: "replaced" }], /^REFUSED unknown-key 1\.body$/m],
    [[{ op: "comment", target: 7, body: `the key is ${TOKEN}` }], /^REFUSED secret 1\.body$/m],
    [[{ op: "comment", target: 7, body: HIDDEN }], /^REFUSED hidden 1\.body$/m],
  ];
  try {
    for (const [ops, line] of cases) {
      const plan = jsonl(...ops);
      const out = await readThenApply(p, ["edit", "--id", "7"], plan);
      const seen = `${JSON.stringify(ops)}\n${out.stdout}${out.stderr}`;
      assertEquals(out.code, 3, seen);
      assertMatch(out.stdout, line, seen);
      assertEquals(out.lines.at(-1), "RECEIPT: none", seen);
      assert(!GH_WRITES.test(out.calls), `${seen}\nwrote:\n${out.calls}`);
      assert(!out.stdout.includes(TOKEN) && !out.stderr.includes(TOKEN), seen);
      assert(!out.stdout.includes(HIDDEN) && !out.stderr.includes(HIDDEN), seen);
    }
    // A value a variable named like a secret holds is refused, whatever it looks like.
    const held = await readThenApply(
      p,
      ["edit", "--id", "7"],
      jsonl({ op: "comment", target: 7, body: `see ${ENV_VALUE} here` }),
      { env: { [SECRET_NAMES[0]]: ENV_VALUE } },
    );
    assertEquals(
      [held.code, held.lines],
      [3, ["REFUSED secret 1.body", "RECEIPT: none"]],
      held.stderr,
    );
    assert(!GH_WRITES.test(held.calls), held.calls);
    // A plan that is not JSON Lines, or holds an extra line in another shape, is refused whole.
    const broken = await readThenApply(
      p,
      ["edit", "--id", "7"],
      '{"op":"comment","target":7,"body":"x"}\nnot json\n',
    );
    assertEquals([broken.code, broken.lines[0]], [3, "REFUSED parse 2"], broken.stdout);
    assert(!GH_WRITES.test(broken.calls), broken.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: an encoded value passes the scan, the residual the scan documents", async () => {
  const p = await ghProject(issues);
  try {
    const out = await readThenApply(
      p,
      ["edit", "--id", "7"],
      jsonl({ op: "comment", target: 7, body: `blob ${btoa(TOKEN)}` }),
    );
    assertEquals([out.code, out.lines], [0, ["APPLIED comment 7", "RECEIPT: none"]], out.stderr);
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: add resolves a new item's @ref for the operations after it", async () => {
  const p = await ghProject({ 9: ghIssue("An epic") });
  try {
    const out = await readThenApply(
      p,
      ["add", "--id", "9"],
      jsonl(
        {
          op: "create",
          ref: "@a",
          title: "Split $(touch marker) out",
          body: "Why.",
          labels: ["tech-debt"],
        },
        { op: "link", target: "@a", parent: 9 },
        { op: "classify", target: "@a", axis: "IssueType", value: "Feature" },
      ),
    );
    assertEquals(out.code, 0, out.stdout + out.stderr);
    assertEquals(out.lines, [
      "APPLIED create 5",
      "APPLIED link 5",
      "APPLIED classify 5",
      "RECEIPT: none",
    ]);
    assertStringIncludes(
      out.calls,
      "gh\tissue\tcreate\t--repo\tacme/my-app\t--title\tSplit $(touch marker) out\t--body-file\t",
    );
    assertStringIncludes(out.calls, "\t--label\ttech-debt\n");
    assertStringIncludes(
      out.calls,
      "gh\tapi\t-X\tPOST\trepos/acme/my-app/issues/9/sub_issues\t-F\tsub_issue_id=1005\n",
    );
    assertStringIncludes(
      out.calls,
      "gh\tapi\t-X\tPATCH\trepos/acme/my-app/issues/5\t-f\ttype=Feature\t",
    );
    assert(!(await exists(join(p.dir, "marker"))), "a title ran as a command");
    // A ref no earlier line created resolves to nothing, and the plan is refused.
    const dangling = await readThenApply(
      p,
      ["add", "--id", "9"],
      jsonl({ op: "link", target: "@b", parent: 9 }),
    );
    assertEquals([dangling.code, dangling.lines[0]], [3, "REFUSED scope 1.target"]);
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: with no secret scan to run, nothing is written", async () => {
  const p = await ghProject(issues);
  try {
    const out = await readThenApply(
      p,
      ["edit", "--id", "7"],
      jsonl({ op: "comment", target: 7, body: "Plain words." }),
      { between: () => Deno.remove(join(p.dir, ".specnaut/scripts/bash/_report_text.sh")) },
    );
    assertEquals(out.code, 2, out.stdout + out.stderr);
    assert(!GH_WRITES.test(out.calls), out.calls);
    assert(!out.stdout.includes("APPLIED"), out.stdout);
  } finally {
    await p.cleanup();
  }
});
