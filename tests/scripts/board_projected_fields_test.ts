import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * cli#601 — a single-select projected from the organization is a NATIVE field,
 * and must be read and written as one.
 *
 * `gh project field-list` reports such a field as `ProjectV2SingleSelectField`
 * with `options` null: the field belongs to the project, the OPTIONS belong to
 * the organization. Before #600 that shape aborted the detector outright; after
 * it, the field merely looked *absent*, so `set-field.sh` routed the value to a
 * `priority:*` label — placing a label beside a native field that already holds
 * the value. That is the dual-signal drift the native-field rule exists to
 * prevent, and it was silent.
 *
 * **The two forms take different mutations, and that is the whole test.**
 * `updateProjectV2ItemFieldValue` addresses a project ITEM; a projected field's
 * value lives on the ISSUE, against the organization's field, and is written
 * with `setIssueFieldValue`. So each case asserts which call was made, not only
 * that the script exited 0 — a script that wrote nothing would pass an
 * exit-code-only test.
 *
 * `setIssueFieldValue` rather than `updateIssueFieldValue` / `createIssueFieldValue`
 * (all three exist): those require the value to already exist / not exist, so
 * either forces a read-before-write to choose between them, with a race in the
 * gap. `set` is the idempotent upsert.
 *
 * **Which form a field takes is the project's answer, not an inference**
 * (cli#619). The project's GraphQL fields expose `isIssueField` and the
 * `issueField` they project; that link decides the form and supplies the
 * organization field's id and options. Two inferences preceded it and both
 * failed: an `IFD_…` id prefix (a second board listed the same projected date
 * with a `PVTF_…` id) and a name match against the organization's fields (a
 * board may own a field of the same name without projecting it).
 */

const GITHUB_DIR = "../../templates/core/skills/board/scripts/github";

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

/**
 * A field as `gh project field-list` lists it, plus what the project's own
 * GraphQL answers about it (cli#619): `isIssueField`, and the organization
 * field it projects (`issueField`). The two extra keys are stripped from the
 * `field-list` document — `gh` does not print them — and served only to the
 * query that asks for them.
 */
type Field = {
  id: string;
  name: string;
  type: string;
  options?: unknown;
  isIssueField?: boolean;
  issueField?: unknown;
};

const PRIORITY_OPTIONS = [
  { id: "IFSSO_urgent", name: "Urgent" },
  { id: "IFSSO_high", name: "High" },
];

/** Project-local single-select: the project carries its own options. */
const LOCAL_PRIORITY: Field = {
  id: "PVTSSF_local",
  name: "Priority",
  type: "ProjectV2SingleSelectField",
  options: [{ id: "opt_p0", name: "P0" }, { id: "opt_p2", name: "P2" }],
};
/** Projected from the org: same type, no options here — they are the org's. */
const PROJECTED_PRIORITY: Field = {
  id: "PVTSSF_projected",
  name: "Priority",
  type: "ProjectV2SingleSelectField",
  options: null,
  issueField: {
    __typename: "IssueFieldSingleSelect",
    id: "IFSS_priority",
    options: PRIORITY_OPTIONS,
  },
};
/** A date the project owns — written through the project item. */
const LOCAL_TARGET_DATE: Field = { id: "PVTF_target", name: "Target date", type: "ProjectV2Field" };
/**
 * A projected organization date as cli#614 saw it listed: `ProjectV2Field` by
 * type, but an `IFD_…` id — the node GitHub refuses to resolve as a project
 * field ("Could not resolve to ProjectV2Field … 'IFD_…'").
 */
const PROJECTED_TARGET_DATE: Field = {
  id: "IFD_target",
  name: "Target date",
  type: "ProjectV2Field",
  issueField: { __typename: "IssueFieldDate", id: "IFD_target" },
};
/**
 * The same projected date as cli#619 saw it listed on another board: a
 * `PVTF_…` id, indistinguishable by listing from a date the project owns. Only
 * the project's `isIssueField` / `issueField` tell them apart.
 */
const PROJECTED_TARGET_DATE_PVTF: Field = {
  id: "PVTF_projtarget",
  name: "Target date",
  type: "ProjectV2Field",
  issueField: { __typename: "IssueFieldDate", id: "IFD_target" },
};
const SIZE_LOCAL: Field = {
  id: "F_size",
  name: "Size",
  type: "ProjectV2SingleSelectField",
  options: [{ id: "opt_s", name: "S" }],
};

/**
 * What the organization answers for its own issue fields. Every name here is
 * also a field name some fixture above uses, on purpose: a board may own a
 * field of the same name as the organization's without projecting it, and the
 * route must not be decided by that coincidence.
 */
const ORG_FIELDS = {
  data: {
    organization: {
      issueFields: {
        nodes: [
          { __typename: "IssueFieldDate", id: "IFD_target", name: "Target date" },
          {
            __typename: "IssueFieldSingleSelect",
            id: "IFSS_priority",
            name: "Priority",
            options: PRIORITY_OPTIONS,
          },
        ],
      },
    },
  },
};

/** The project's own answer to "which of your fields are issue fields". */
function projectLinks(fields: Field[]) {
  return {
    data: {
      node: {
        fields: {
          nodes: fields.map((f) => ({
            id: f.id,
            isIssueField: f.isIssueField ?? f.issueField != null,
            issueField: f.issueField ?? null,
          })),
        },
      },
    },
  };
}

/** The `field-list` document: what `gh` prints, with no link keys. */
function listed(fields: Field[]) {
  return fields.map(({ isIssueField: _i, issueField: _f, ...f }) => f);
}

async function stubbedProject(
  fields: Field[],
  opts: { issueMissing?: boolean; linksFail?: boolean } = {},
): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "board-projected-" });
  const scripts = `${tmp}/board/scripts/github`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });

  for (const name of ["_config.sh", "detect-fields.sh", "set-field.sh"]) {
    await Deno.copyFile(scriptPath(`${GITHUB_DIR}/${name}`), `${scripts}/${name}`);
    await Deno.chmod(`${scripts}/${name}`, 0o755);
  }
  await Deno.writeTextFile(
    `${tmp}/.specnaut/backlog-config.yml`,
    'repo: "acme/my-app"\nproject_number: 7\n',
  );

  await Deno.writeTextFile(
    `${tmp}/bin/gh`,
    `#!/usr/bin/env bash
echo "\$*" >> "${tmp}/gh-calls.log"
if [ "\$1" = "auth" ]; then exit 0; fi
if [ "\$1" = "project" ] && [ "\$2" = "field-list" ]; then
  cat <<'JSON'
${JSON.stringify({ fields: listed(fields) })}
JSON
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "view" ]; then
  if [[ "\$*" == *"--jq"* ]]; then echo 'PVT_stub'; else echo '{"id":"PVT_stub"}'; fi
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "item-edit" ]; then exit 0; fi
if [ "\$1" = "issue" ] && [ "\$2" = "view" ]; then
  if [ "${opts.issueMissing ? 1 : 0}" = 1 ]; then
    echo "GraphQL: Could not resolve to an issue or pull request with the number of 42." >&2
    exit 1
  fi
  echo 'I_issuenode'; exit 0
fi
if [ "\$1" = "api" ] && [ "\$2" = "graphql" ]; then
  # The org issue-field query and the setIssueFieldValue mutation arrive on the
  # same command; the caller distinguishes them by what it asked for.
  case "\$*" in
    *setIssueFieldValue*) echo '{"data":{"setIssueFieldValue":{"clientMutationId":null}}}'; exit 0 ;;
    *isIssueField*)
      if [ "${
      opts.linksFail ? 1 : 0
    }" = 1 ]; then echo "HTTP 502: Bad Gateway (https://api.github.com/graphql)" >&2; exit 1; fi
      cat <<'JSON'
${JSON.stringify(projectLinks(fields))}
JSON
      exit 0 ;;
    *issueFields*)
      cat <<'JSON'
${JSON.stringify(ORG_FIELDS)}
JSON
      exit 0 ;;
    *projectItems*) echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"PVTI_x","project":{"id":"PVT_stub"}}]}}}}}'; exit 0 ;;
  esac
  echo '{}'; exit 0
fi
echo "unexpected gh invocation: \$*" >&2
exit 1
`,
  );
  await Deno.chmod(`${tmp}/bin/gh`, 0o755);
  return tmp;
}

async function run(tmp: string, script: string, args: string[] = []) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [`${tmp}/board/scripts/github/${script}`, ...args],
    env: { PATH: `${tmp}/bin:${Deno.env.get("PATH")}` },
    clearEnv: false,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
    calls: await Deno.readTextFile(`${tmp}/gh-calls.log`).catch(() => ""),
  };
}

/**
 * The one logged `gh` invocation containing `marker`, whole. A GraphQL query
 * spans lines, so the log is split per invocation — an entry starts at column
 * 0, its query's continuation lines are indented — not per line.
 */
function invocation(calls: string, marker: string): string {
  return calls.split(/\n(?=\S)/).find((c) => c.includes(marker)) ?? "";
}

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
