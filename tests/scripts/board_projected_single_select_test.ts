// cli#601 — a single-select projected from the organization is a native field:
// read with the organization's options, written on the issue with
// `setIssueFieldValue`, never through the project item. The account of why the
// two forms take different mutations is in board_projected_fields_fixture.ts.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type Field,
  invocation,
  LOCAL_PRIORITY,
  PROJECTED_PRIORITY,
  run,
  SIZE_LOCAL,
  stubbedProject,
} from "./board_projected_fields_fixture.ts";

// ── Read ───────────────────────────────────────────────────────────────────

Deno.test("a projected field's options are resolved from the organization", async () => {
  const tmp = await stubbedProject([PROJECTED_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "PRIORITY_FIELD_FORM=projected");
    assertStringIncludes(r.stdout, "PRIORITY_ORG_FIELD_ID=IFSS_priority");
    // The options come across in the SAME shape as a project-local field, so
    // callers need no new vocabulary — that was the point of AC 2.
    assertStringIncludes(r.stdout, "PRIORITY_OPT_URGENT=IFSSO_urgent");
    assertStringIncludes(r.stdout, 'PRIORITY_OPT_NAMES="Urgent, High"');
    assertStringIncludes(r.stdout, "PRIORITY_FIRST_OPT_ID=IFSSO_urgent");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a project-local field is reported local and costs no query at all", async () => {
  // `add.sh` runs the detector on every issue it files, for Status alone: a
  // board whose single-selects all carry their own options must not pay a
  // GraphQL call to learn what their listing already says.
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "PRIORITY_FIELD_FORM=local");
    assertStringIncludes(r.stdout, "PRIORITY_OPT_P0=opt_p0");
    assert(!r.calls.includes("api graphql"), `a query was spent on local fields:\n${r.calls}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a projected field whose organization field is unreadable degrades, it does not abort", async () => {
  // `isIssueField` true with `issueField` null: the project says the field is
  // the organization's but not which one (a token that cannot read it). The
  // form is still projected — the project mutation would be refused — and the
  // options are empty, which `set-field.sh` answers with its label fallback.
  const unlinked = { ...PROJECTED_PRIORITY, isIssueField: true, issueField: null };
  const tmp = await stubbedProject([unlinked, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, `the detector aborted: ${r.stderr}`);
    assertStringIncludes(r.stdout, "PRIORITY_FIELD_FORM=projected");
    assertStringIncludes(r.stdout, "PRIORITY_ORG_FIELD_ID=\n");
    assertStringIncludes(r.stdout, 'PRIORITY_OPT_NAMES=""');
    // Size is emitted AFTER Priority: holding it proves the run continued.
    assertStringIncludes(r.stdout, "SIZE_FIELD_ID=F_size");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ── Write: each form takes its own mutation ────────────────────────────────

Deno.test("a projected field is written natively, not through the project", async () => {
  const tmp = await stubbedProject([PROJECTED_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "Priority", "Urgent"]);
    assertEquals(r.code, 0, `${r.stdout}${r.stderr}`);

    assertStringIncludes(
      r.calls,
      "setIssueFieldValue",
      "the value did not go through the issue-field mutation",
    );
    assertStringIncludes(r.calls, "IFSS_priority", "the organization field id was not used");
    assertStringIncludes(r.calls, "IFSSO_urgent", "the organization option id was not used");

    // THE assertion for the defect: no label, and no project-item write.
    assert(
      !r.calls.includes("project item-edit"),
      "a projected field was written through the project item — that addresses " +
        "the wrong object",
    );
    assert(
      !r.calls.includes("--add-label"),
      "the value fell back to a label even though a native field holds it — " +
        "this is the dual-signal drift cli#601 exists to remove",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a project-local field keeps the existing project-item path", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "Priority", "P0"]);
    assertEquals(r.code, 0, `${r.stdout}${r.stderr}`);
    assertStringIncludes(r.calls, "project item-edit");
    assertStringIncludes(r.calls, "opt_p0");
    assert(
      !r.calls.includes("setIssueFieldValue"),
      "a project-local field was written through the organization path — no " +
        "regression in the existing route was allowed",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("an option the projected field does not have falls back, and is never mapped", async () => {
  // The vocabularies genuinely differ: this organization's `Priority` is
  // Urgent/High, while Specnaut's own is P0..P3. Translating P0 → Urgent would
  // be a silent mis-write dressed as helpfulness. Exit 11 hands it to a label,
  // which is visibly approximate and is the documented contract.
  const tmp = await stubbedProject([PROJECTED_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "set-field.sh", ["42", "Priority", "P0"]);
    assertEquals(r.code, 11, `expected the label-fallback exit, got ${r.code}: ${r.stderr}`);
    assert(
      !r.calls.includes("setIssueFieldValue"),
      "a value with no matching option was written anyway",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("exit 10 is still reserved for a field that exists in neither form", async () => {
  const tmp = await stubbedProject([SIZE_LOCAL]);
  try {
    // An absent axis clears every routing variable, as the date axes do: an
    // `eval` into a shell that already held an organization id must not keep it.
    const detect = await run(tmp, "detect-fields.sh");
    assertStringIncludes(detect.stdout, "PRIORITY_ORG_FIELD_ID=\n");
    const r = await run(tmp, "set-field.sh", ["42", "Priority", "P0"]);
    assertEquals(r.code, 10, `expected 'no such field', got ${r.code}: ${r.stderr}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a project-owned single-select with no options is not taken for the organization's", async () => {
  // A listing with no options is the shape of a projected field — and also of
  // a project field whose options were all deleted. Matching it to the
  // organization's field of the same name wrote the organization's value on
  // the issue: a successful write to a field this board does not show. The
  // project's `isIssueField` settles it.
  const bare: Field = {
    id: "PVTSSF_bare",
    name: "Priority",
    type: "ProjectV2SingleSelectField",
    options: [],
  };
  const tmp = await stubbedProject([bare, SIZE_LOCAL]);
  try {
    const detect = await run(tmp, "detect-fields.sh");
    assertEquals(detect.code, 0, detect.stderr);
    assertStringIncludes(detect.stdout, "PRIORITY_FIELD_FORM=local");
    assertStringIncludes(detect.stdout, 'PRIORITY_OPT_NAMES=""');

    const r = await run(tmp, "set-field.sh", ["42", "Priority", "Urgent"]);
    assertEquals(r.code, 11, `expected the label-fallback exit, got ${r.code}: ${r.stderr}`);
    assert(
      !r.calls.includes("setIssueFieldValue"),
      "the value was written to the organization's field of the same name",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a projected single-select takes its id and options from the project's link", async () => {
  // Not from a name match on the organization's fields: the org lookup is not
  // asked at all, and one query serves every field that needs it.
  const tmp = await stubbedProject([PROJECTED_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "PRIORITY_ORG_FIELD_ID=IFSS_priority");
    assert(!r.calls.includes("issueFields"), `the organization was queried by name:\n${r.calls}`);
    const link = invocation(r.calls, "isIssueField");
    assertStringIncludes(link, "project=PVT_stub", "the link query did not address the project");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
