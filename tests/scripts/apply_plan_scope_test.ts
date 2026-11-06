import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { GH_WRITES, ghIssue, ghProject, jsonl, readThenApply } from "./apply_plan_fixture.ts";
import { gitProject } from "./read_items_fixture.ts";

/**
 * What `apply-plan.sh` accepts past the first four axes and the plain verbs:
 * the date and estimate axes set-field.sh writes on GitHub (UNSUPPORTED where
 * a backend has none), the tech-debt intake classifying the items it creates,
 * and a close reaching the children its own cascade check lists. Real
 * scripts, stand-in tracker CLIs.
 */

const FIELDS = JSON.stringify({
  fields: [
    { id: "F1", name: "Status", type: "ProjectV2SingleSelectField", options: [] },
    {
      id: "F2",
      name: "Priority",
      type: "ProjectV2SingleSelectField",
      options: ["P0", "P1", "P2", "P3"].map((n) => ({ id: `p${n}`, name: n })),
    },
    { id: "F3", name: "Target date", type: "ProjectV2Field" },
    { id: "F4", name: "Start date", type: "ProjectV2Field" },
    { id: "F5", name: "Estimate", type: "ProjectV2Field" },
  ],
});
const issues = { 7: ghIssue("Export times out"), 9: ghIssue("An epic"), 10: ghIssue("A child") };
const classify = (axis: string, value: unknown) => ({ op: "classify", target: 7, axis, value });

Deno.test("apply-plan: GitHub sets the date and estimate axes as set-field.sh takes them", async () => {
  const p = await ghProject(issues, { "fields.json": FIELDS });
  try {
    const out = await readThenApply(
      p,
      ["edit", "--id", "7"],
      jsonl(classify("TargetDate", "2026-06-30"), classify("StartDate", "2026-05-01"), {
        ...classify("Estimate", 2.5),
      }),
    );
    assertEquals(out.lines, [
      "APPLIED classify 7",
      "APPLIED classify 7",
      "APPLIED classify 7",
      "RECEIPT: none",
    ], out.stderr);
    assertStringIncludes(out.calls, "\t--field-id\tF3\t--date\t2026-06-30\n");
    assertStringIncludes(out.calls, "\t--field-id\tF4\t--date\t2026-05-01\n");
    assertStringIncludes(out.calls, "\t--field-id\tF5\t--number\t2.5\n");
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: a date or estimate outside its shape is refused before any write", async () => {
  const p = await ghProject(issues, { "fields.json": FIELDS });
  try {
    for (
      const [axis, value] of [
        ["TargetDate", "2026-13-01"],
        ["TargetDate", "30/06/2026"],
        ["StartDate", "2026-05-01T00:00:00Z"],
        ["StartDate", 20260501],
        ["Estimate", "3"],
        ["Estimate", -1],
        ["Estimate", 1e12],
        ["Estimate", 0.125],
      ] as const
    ) {
      const out = await readThenApply(p, ["edit", "--id", "7"], jsonl(classify(axis, value)));
      assertEquals([out.code, out.lines], [3, ["REFUSED value 1.value", "RECEIPT: none"]], axis);
      assert(!GH_WRITES.test(out.calls), out.calls);
    }
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: a backend with no date or estimate field answers UNSUPPORTED", async () => {
  for (const backend of ["local", "gitlab"] as const) {
    const p = await gitProject(backend);
    try {
      for (const [axis, value] of [["TargetDate", "2026-06-30"], ["Estimate", 3]] as const) {
        const out = await readThenApply(
          p,
          ["add"],
          jsonl({ op: "create", ref: "@a", title: "New" }, {
            ...classify(axis, value),
            target: "@a",
          }),
        );
        assertEquals(
          [out.code, out.lines],
          [3, ["UNSUPPORTED classify", "RECEIPT: none"]],
          backend,
        );
      }
    } finally {
      await p.cleanup();
    }
  }
});

Deno.test("apply-plan: tech-debt classifies and labels its own new items, never an existing one", async () => {
  const p = await ghProject(issues);
  try {
    const out = await readThenApply(
      p,
      ["tech-debt", "7"],
      jsonl(
        { op: "create", ref: "@d", title: "Debt", body: "Surfaced by #7." },
        { op: "classify", target: "@d", axis: "Priority", value: "P1" },
        { op: "label", target: "@d", labels: ["tech-debt"] },
      ),
    );
    assertEquals(out.lines, [
      "APPLIED create 5",
      "APPLIED classify 5",
      "APPLIED label 5",
      "RECEIPT: none",
    ], out.stderr);
    const existing = await readThenApply(
      p,
      ["tech-debt", "7"],
      jsonl({ op: "label", target: 7, labels: ["tech-debt"] }),
    );
    assertEquals([existing.code, existing.lines[0]], [3, "REFUSED scope 1.target"]);
    assert(!GH_WRITES.test(existing.calls), existing.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("apply-plan: a close reaches the children its cascade check lists, nothing else", async () => {
  const kids = JSON.stringify([{ state: "closed", number: 10, title: "A child" }]);
  const p = await ghProject(issues, { "children-9.json": kids });
  try {
    const listed = await p.run("cascade-check.sh", ["--numbers", "9"]);
    const children = listed.stdout.trim().split("\n");
    assertEquals(children, ["10"]);
    const plan = jsonl(
      { op: "comment", target: 10, body: "Closed with its epic." },
      { op: "close", target: 9, reason: "completed" },
    );
    const out = await readThenApply(p, ["close", "--id", "9", ...children], plan);
    assertEquals(out.lines, [
      "APPLIED comment 10",
      "APPLIED close 9",
      "APPLIED move 9",
      "RECEIPT: none",
    ], out.stderr);
    const other = await readThenApply(
      p,
      ["close", "--id", "9", "7"],
      jsonl({ op: "comment", target: 7, body: "x" }),
    );
    assertEquals([other.code, other.lines[0]], [3, "REFUSED scope 1.target"]);
  } finally {
    await p.cleanup();
  }
});
