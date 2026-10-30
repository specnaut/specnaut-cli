// Shared fixture for the projected-field tests (board_projected_*_test.ts):
// the field shapes `gh project field-list` lists, the project's and the
// organization's GraphQL answers, a stubbed `gh` that serves them, and a runner
// for the github backend's detect-fields.sh / set-field.sh.

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

const GITHUB_DIR = "../../templates/core/skills/task/scripts/github";

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
export type Field = {
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
export const LOCAL_PRIORITY: Field = {
  id: "PVTSSF_local",
  name: "Priority",
  type: "ProjectV2SingleSelectField",
  options: [{ id: "opt_p0", name: "P0" }, { id: "opt_p2", name: "P2" }],
};
/** Projected from the org: same type, no options here — they are the org's. */
export const PROJECTED_PRIORITY: Field = {
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
export const LOCAL_TARGET_DATE: Field = {
  id: "PVTF_target",
  name: "Target date",
  type: "ProjectV2Field",
};
/**
 * A projected organization date as cli#614 saw it listed: `ProjectV2Field` by
 * type, but an `IFD_…` id — the node GitHub refuses to resolve as a project
 * field ("Could not resolve to ProjectV2Field … 'IFD_…'").
 */
export const PROJECTED_TARGET_DATE: Field = {
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
export const PROJECTED_TARGET_DATE_PVTF: Field = {
  id: "PVTF_projtarget",
  name: "Target date",
  type: "ProjectV2Field",
  issueField: { __typename: "IssueFieldDate", id: "IFD_target" },
};
export const SIZE_LOCAL: Field = {
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

export async function stubbedProject(
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

export async function run(tmp: string, script: string, args: string[] = []) {
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
export function invocation(calls: string, marker: string): string {
  return calls.split(/\n(?=\S)/).find((c) => c.includes(marker)) ?? "";
}
