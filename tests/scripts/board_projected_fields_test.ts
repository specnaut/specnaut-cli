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
 */

const GITHUB_DIR = "../../templates/core/skills/board/scripts/github";

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

/** Project-local single-select: the project carries its own options. */
const LOCAL_PRIORITY = {
  id: "PVTSSF_local",
  name: "Priority",
  type: "ProjectV2SingleSelectField",
  options: [{ id: "opt_p0", name: "P0" }, { id: "opt_p2", name: "P2" }],
};
/** Projected from the org: same type, no options here. */
const PROJECTED_PRIORITY = {
  id: "PVTSSF_projected",
  name: "Priority",
  type: "ProjectV2SingleSelectField",
  options: null,
};
const SIZE_LOCAL = {
  id: "F_size",
  name: "Size",
  type: "ProjectV2SingleSelectField",
  options: [{ id: "opt_s", name: "S" }],
};

/** What the organization answers for its own issue fields. */
const ORG_FIELDS = {
  data: {
    organization: {
      issueFields: {
        nodes: [
          { __typename: "IssueFieldDate" },
          {
            __typename: "IssueFieldSingleSelect",
            id: "IFSS_priority",
            name: "Priority",
            options: [
              { id: "IFSSO_urgent", name: "Urgent" },
              { id: "IFSSO_high", name: "High" },
            ],
          },
        ],
      },
    },
  },
};

async function stubbedProject(
  fields: unknown[],
  opts: { orgFields?: unknown } = {},
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
${JSON.stringify({ fields })}
JSON
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "view" ]; then
  if [[ "\$*" == *"--jq"* ]]; then echo 'PVT_stub'; else echo '{"id":"PVT_stub"}'; fi
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "item-edit" ]; then exit 0; fi
if [ "\$1" = "issue" ] && [ "\$2" = "view" ]; then echo 'I_issuenode'; exit 0; fi
if [ "\$1" = "api" ] && [ "\$2" = "graphql" ]; then
  # The org issue-field query and the setIssueFieldValue mutation arrive on the
  # same command; the caller distinguishes them by what it asked for.
  case "\$*" in
    *setIssueFieldValue*) echo '{"data":{"setIssueFieldValue":{"clientMutationId":null}}}'; exit 0 ;;
    *issueFields*) cat <<'JSON'
${JSON.stringify(opts.orgFields ?? ORG_FIELDS)}
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

Deno.test("a project-local field is reported local and costs no organization query", async () => {
  const tmp = await stubbedProject([LOCAL_PRIORITY, SIZE_LOCAL]);
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "PRIORITY_FIELD_FORM=local");
    assertStringIncludes(r.stdout, "PRIORITY_OPT_P0=opt_p0");
    assert(
      !r.calls.includes("issueFields"),
      "the organization was queried for a field whose options were already present",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a projected field the organization does not know degrades, it does not abort", async () => {
  const empty = { data: { organization: { issueFields: { nodes: [] } } } };
  const tmp = await stubbedProject([PROJECTED_PRIORITY, SIZE_LOCAL], { orgFields: empty });
  try {
    const r = await run(tmp, "detect-fields.sh");
    assertEquals(r.code, 0, `the detector aborted: ${r.stderr}`);
    assertStringIncludes(r.stdout, "PRIORITY_FIELD_FORM=local");
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
    const r = await run(tmp, "set-field.sh", ["42", "Priority", "P0"]);
    assertEquals(r.code, 10, `expected 'no such field', got ${r.code}: ${r.stderr}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
