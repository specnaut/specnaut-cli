// cli#614 / cli#619 — a date projected from the organization takes the same
// route as a projected single-select: written on the issue with
// `setIssueFieldValue` + `dateValue`, never through `gh project item-edit`.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  invocation,
  LOCAL_PRIORITY,
  LOCAL_TARGET_DATE,
  PROJECTED_TARGET_DATE,
  PROJECTED_TARGET_DATE_PVTF,
  run,
  SIZE_LOCAL,
  stubbedProject,
} from "./board_projected_fields_fixture.ts";

// ── Dates: the same two forms, the same routing rule (cli#614) ─────────────
//
// #601 gave the single-selects a native write path and left the dates on the
// project mutation. An issue-level date then got a non-empty field id, was
// written through `gh project item-edit --date`, and GitHub refused it — which
// the groom contract reads as a failed mandatory step, indistinguishable from
// a transient fault. The date route uses the vocabulary #601 introduced
// (`<AXIS>_FIELD_FORM` + `<AXIS>_ORG_FIELD_ID`) and the same upsert
// (`setIssueFieldValue`), differing only in the value slot: `dateValue`.

Deno.test("an issue-level date is reported projected, with the organization's field id", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, PROJECTED_TARGET_DATE]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "TARGETDATE_FIELD_ID=IFD_target");
    assertStringIncludes(r.stdout, "TARGETDATE_FIELD_FORM=projected");
    assertStringIncludes(r.stdout, "TARGETDATE_ORG_FIELD_ID=IFD_target");
    // The organization query must ASK for date fields — the stub answers the
    // same document whatever is asked, so the query text is the only proof.
    assertStringIncludes(r.calls, "on IssueFieldDate");
    // The gate `groom.md` reads is unchanged: an axis the board lacks is empty.
    assertStringIncludes(r.stdout, "STARTDATE_FIELD_ID=\n");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a project-owned date is reported local, although the org has one of that name", async () => {
  // The organization has a `Target date` too (ORG_FIELDS). This board owns its
  // own and does not project the organization's; the project says so.
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, LOCAL_TARGET_DATE]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "TARGETDATE_FIELD_ID=PVTF_target");
    assertStringIncludes(r.stdout, "TARGETDATE_FIELD_FORM=local");
    assertStringIncludes(r.stdout, "TARGETDATE_ORG_FIELD_ID=\n");
    // A listed date is ambiguous by listing alone, so the project is asked —
    // the organization never is.
    assertStringIncludes(r.calls, "isIssueField", "the project was not asked about its date");
    assert(!r.calls.includes("issueFields"), "the organization was queried by name");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("an issue-level date is written on the issue with setIssueFieldValue + dateValue", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, PROJECTED_TARGET_DATE]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "TargetDate", "2026-10-01"]);
    assertEquals(r.code, 0, `${r.stdout}${r.stderr}`);
    const write = invocation(r.calls, "setIssueFieldValue");
    assert(write, `the date did not go through the issue-field mutation:\n${r.calls}`);
    assertStringIncludes(write, "dateValue", "the value was not put in the date slot");
    assertStringIncludes(write, "issue=I_issuenode", "the issue node id was not used");
    assertStringIncludes(write, "field=IFD_target", "the organization field id was not used");
    assertStringIncludes(write, "value=2026-10-01", "the date was not passed through");
    assert(
      !r.calls.includes("project item-edit"),
      "an issue-level date was written through the project item — GitHub refuses that id",
    );
    assert(
      !r.calls.includes("projectItems"),
      "the issue-level write asked whether the issue is a project item; it need not be one",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a projected date listed with a PVTF_ id is reported projected (cli#619)", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, PROJECTED_TARGET_DATE_PVTF]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "TARGETDATE_FIELD_ID=PVTF_projtarget");
    assertStringIncludes(r.stdout, "TARGETDATE_FIELD_FORM=projected");
    assertStringIncludes(r.stdout, "TARGETDATE_ORG_FIELD_ID=IFD_target");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a projected date listed with a PVTF_ id is written on the issue (cli#619)", async () => {
  // The defect as reported: routed `local`, sent through
  // `updateProjectV2ItemFieldValue`, refused by GitHub, exit 1.
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, PROJECTED_TARGET_DATE_PVTF]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "TargetDate", "2026-10-01"]);
    assertEquals(r.code, 0, `${r.stdout}${r.stderr}`);
    const write = invocation(r.calls, "setIssueFieldValue");
    assert(write, `the date did not go through the issue-field mutation:\n${r.calls}`);
    assertStringIncludes(write, "dateValue");
    assertStringIncludes(
      write,
      "field=IFD_target",
      "the linked organization field id was not used",
    );
    assert(
      !r.calls.includes("project item-edit"),
      "a projected date was written through the project item — GitHub refuses that",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a project-local date keeps the existing project-item --date path", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, LOCAL_TARGET_DATE]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "TargetDate", "2026-10-01"]);
    assertEquals(r.code, 0, `${r.stdout}${r.stderr}`);
    const write = invocation(r.calls, "project item-edit");
    assertStringIncludes(write, "--field-id PVTF_target");
    assertStringIncludes(write, "--date 2026-10-01");
    assert(!r.calls.includes("setIssueFieldValue"), "a project-local date took the org route");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("an issue-level date on an issue that does not exist exits 12, and writes nothing", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, PROJECTED_TARGET_DATE], {
    issueMissing: true,
  });
  try {
    const r = await run(tmp, "set-field.sh", ["42", "TargetDate", "2026-10-01"]);
    assertEquals(r.code, 12, `${r.stdout}${r.stderr}`);
    assert(!r.calls.includes("setIssueFieldValue"), "a write was attempted with no issue id");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("an issue-level date whose organization field is unreadable degrades to exit 10, unwritten", async () => {
  // The project says the date is an issue field but not which one. The project
  // mutation will be refused, so the route must not fall back to it.
  const unlinked = { ...PROJECTED_TARGET_DATE_PVTF, isIssueField: true, issueField: null };
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL, unlinked]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "TargetDate", "2026-10-01"]);
    assertEquals(r.code, 10, `${r.stdout}${r.stderr}`);
    assert(!r.calls.includes("project item-edit"), "the refused project mutation was attempted");
    assert(!r.calls.includes("setIssueFieldValue"), "a write was attempted with no field id");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("exit 10 is still reserved for a date that exists in neither form", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "StartDate", "2026-10-01"]);
    assertEquals(r.code, 10, `expected 'no such field', got ${r.code}: ${r.stderr}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
