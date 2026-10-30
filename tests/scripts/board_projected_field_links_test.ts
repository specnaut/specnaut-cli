// cli#619 — the project's own field links (`isIssueField` / `issueField`)
// decide which form a field takes: queried once per run, and degrading out
// loud when they cannot be read.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type Field,
  LOCAL_PRIORITY,
  PROJECTED_PRIORITY,
  PROJECTED_TARGET_DATE,
  PROJECTED_TARGET_DATE_PVTF,
  run,
  SIZE_LOCAL,
  stubbedProject,
} from "./board_projected_fields_fixture.ts";

Deno.test("the project's field links are queried once per run, however many fields need them", async () => {
  // The cache must be filled in the current shell: a `$( … )` caller fills it
  // in a subshell where it dies, and each axis queries again — how the earlier
  // organization cache once held nothing. Two projected single-selects and two
  // listed dates need the answer four times. Counted, because only the count
  // shows it.
  const projectedSize = { ...PROJECTED_PRIORITY, id: "PVTSSF_size", name: "Size" };
  const startDate: Field = { id: "PVTF_start", name: "Start date", type: "ProjectV2Field" };
  const tmp = await stubbedProject([
    PROJECTED_PRIORITY,
    projectedSize,
    startDate,
    PROJECTED_TARGET_DATE_PVTF,
  ]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    const queries = r.calls.split("\n").filter((l) => l.includes("isIssueField")).length;
    assertEquals(queries, 1, `the project's links were queried ${queries} times:\n${r.calls}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a failed link lookup degrades as documented, and says so", async () => {
  // The degradation itself is by design — a server whose schema predates
  // `isIssueField` must keep the detector working, so a projected field then
  // reads as the project's. What is not acceptable is that it happens in
  // silence: the caller would see an ordinary answer and nothing named the cause.
  const tmp = await stubbedProject([PROJECTED_PRIORITY, SIZE_LOCAL], { linksFail: true });
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, `the detector aborted: ${r.stderr}`);
    assertStringIncludes(r.stdout, "PRIORITY_FIELD_FORM=local");
    assertStringIncludes(r.stdout, "SIZE_FIELD_ID=F_size");
    assertStringIncludes(
      r.stderr,
      "could not read which of Project #7's fields are organization issue fields",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("with the links unreadable, an IFD_ id still never reaches the project mutation", async () => {
  // The secondary signal. An `IFD_…` id is an organization date's node, which
  // the project mutation cannot resolve whatever else is known. Without the
  // link its organization id is unknown, so the date is not written (exit 10)
  // rather than sent to a mutation certain to refuse it.
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, PROJECTED_TARGET_DATE], {
    linksFail: true,
  });
  try {
    const r = await run(tmp, "set-field.sh", ["42", "TargetDate", "2026-10-01"]);
    assertEquals(r.code, 10, `${r.stdout}${r.stderr}`);
    assert(!r.calls.includes("project item-edit"), "the refused project mutation was attempted");
    assert(!r.calls.includes("setIssueFieldValue"), "a write was attempted with no field id");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
