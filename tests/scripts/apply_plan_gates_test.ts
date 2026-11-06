import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { GH_WRITES, ghIssue, ghProject, jsonl, readThenApply } from "./apply_plan_fixture.ts";
import { readItems, removeRead } from "./read_items_fixture.ts";

/**
 * The gates `apply-plan.sh` holds itself, never trusting the plan: the read it
 * follows (verb, id, fingerprint), the close behind cascade-check.sh, the
 * items a groom may touch, and set-field.sh's exit ladder. Real scripts, a
 * stand-in `gh`.
 */

const issues = { 7: ghIssue("Export times out"), 8: ghIssue("Another"), 9: ghIssue("An epic") };
const OPEN_CHILD = JSON.stringify([{ state: "open", number: 10, title: "A child" }]);
const CLOSED_CHILD = JSON.stringify([{ state: "closed", number: 10, title: "A child" }]);
const comment = jsonl({ op: "comment", target: 7, body: "Which tenant?" });

Deno.test("apply-plan: a plan that does not follow its read is refused", async () => {
  const p = await ghProject(issues);
  try {
    const moved = await readThenApply(p, ["edit", "--id", "7"], comment, {
      between: () => p.write("new-file.txt", "the tree changed\n"),
    });
    assertEquals([moved.code, moved.lines], [3, [
      "REFUSED fingerprint header.fingerprint",
      "RECEIPT: none",
    ]]);
    await Deno.remove(`${p.dir}/new-file.txt`);
    const verb = await readThenApply(p, ["edit", "--id", "7"], comment, {
      apply: ["estimate", "--id", "7"],
    });
    assertEquals([verb.code, verb.lines[0]], [3, "REFUSED verb header.verb"]);
    const id = await readThenApply(p, ["edit", "--id", "7"], comment, {
      apply: ["edit", "--id", "8"],
    });
    assertEquals([id.code, id.lines[0]], [3, "REFUSED id header.id"]);
    const unknown = await readThenApply(p, ["edit", "--id", "7"], comment, {
      apply: ["triage", "--id", "7"],
    });
    assertEquals(unknown.code, 3);
    for (const r of [moved, verb, id, unknown]) assert(!GH_WRITES.test(r.calls), r.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: an epic with an open child is not closed; a cleared one is, then moved", async () => {
  const p = await ghProject(issues, { "children-9.json": OPEN_CHILD });
  try {
    const plan = jsonl({ op: "close", target: 9, reason: "completed" });
    const blocked = await readThenApply(p, ["close", "--id", "9"], plan);
    assertEquals([blocked.code, blocked.lines], [4, ["FAILED close 9 11", "RECEIPT: none"]]);
    assert(!GH_WRITES.test(blocked.calls), blocked.calls);
    await p.write("fake/children-9.json", CLOSED_CHILD);
    const cleared = await readThenApply(p, ["close", "--id", "9"], plan);
    assertEquals(
      cleared.lines,
      ["APPLIED close 9", "APPLIED move 9", "RECEIPT: none"],
      cleared.stderr,
    );
    assertStringIncludes(
      cleared.calls,
      "gh\tissue\tclose\t9\t--repo\tacme/my-app\t--reason\tcompleted\n",
    );
    assert(
      cleared.calls.indexOf("sub_issues") < cleared.calls.indexOf("issue\tclose"),
      cleared.calls,
    );
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: a groom closes only a cleared epic among the items it read", async () => {
  const p = await ghProject(issues, { "children-9.json": CLOSED_CHILD });
  try {
    const close = (n: number) => jsonl({ op: "close", target: n, reason: "not_planned" });
    const outside = await readThenApply(p, ["groom", "7", "9"], close(8));
    assertEquals([outside.code, outside.lines[0]], [3, "REFUSED scope 1.target"]);
    const notEpic = await readThenApply(p, ["groom", "7", "9"], close(7));
    assertEquals([notEpic.code, notEpic.lines[0]], [3, "REFUSED scope 1.target"]);
    const create = await readThenApply(
      p,
      ["groom", "7", "9"],
      jsonl({ op: "create", title: "New" }),
    );
    assertEquals([create.code, create.lines[0]], [3, "REFUSED scope 1.op"]);
    for (const r of [outside, notEpic, create]) assert(!GH_WRITES.test(r.calls), r.calls);
    const epic = await readThenApply(p, ["groom", "7", "9"], close(9));
    assertEquals(epic.lines, ["APPLIED close 9", "APPLIED move 9", "RECEIPT: none"], epic.stderr);
    assertStringIncludes(
      epic.calls,
      "gh\tissue\tclose\t9\t--repo\tacme/my-app\t--reason\tnot planned\n",
    );
  } finally {
    await p.cleanup();
  }
});

Deno.test("read-items: a verb no plan can follow is refused before any read", async () => {
  const p = await ghProject(issues);
  try {
    for (const args of [["triage", "7"], ["edit"], ["close", "7"], ["tech-debt", "--id", "7"]]) {
      const r = await p.run("read-items.sh", args);
      assertEquals([r.code, r.stdout], [2, ""], `${args}\n${r.stderr}`);
      assert(!r.calls.includes("graphql"), r.calls);
    }
    // A verb that only creates may read nothing at all.
    const { r, read } = await readItems(p, ["tech-debt"]);
    try {
      assertEquals([r.code, read?.items, read?.header.id], [0, "none", "none"], r.stderr);
    } finally {
      await removeRead(read);
    }
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: a missing field falls back to its label; tech-debt only creates", async () => {
  const p = await ghProject(issues, { "patch-fails": "" });
  try {
    const out = await readThenApply(
      p,
      ["edit", "--id", "7"],
      jsonl({ op: "classify", target: 7, axis: "IssueType", value: "Feature" }),
    );
    assertEquals(out.lines, ["FALLBACK classify 7", "RECEIPT: none"], out.stderr);
    assertStringIncludes(
      out.calls,
      "gh\tissue\tedit\t7\t--repo\tacme/my-app\t--add-label\ttype:feature\n",
    );
    const debt = await readThenApply(
      p,
      ["tech-debt"],
      jsonl({ op: "comment", target: 7, body: "x" }),
    );
    assertEquals([debt.code, debt.lines[0]], [3, "REFUSED scope 1.op"]);
  } finally {
    await p.cleanup();
  }
});
