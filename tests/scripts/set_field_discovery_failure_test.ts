import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * cli#615 — a FAILED field discovery is not an ABSENT field.
 *
 * `set-field.sh` exists to keep grooming on native fields and off labels, and
 * its exit 10 means "no native field — the caller applies a label instead".
 * It used to reach that answer through `eval "$(detect-fields.sh)"`. `eval`
 * returns its OWN status, not the substituted command's, and `eval ""` is 0 —
 * so under `set -euo pipefail` a detector that died (rate limit, bad token,
 * any `gh` error) left every `*_FIELD_ID` unset, the absent-field guard fired,
 * and the script exited 10. A caller obeying the contract then wrote a
 * `priority:*` label beside a native field that already exists: the
 * dual-signal drift the helper exists to prevent, triggered by a transient
 * fault and reported as a normal outcome.
 *
 * Each case asserts the dedicated exit code AND that no write was attempted —
 * a script that exited 13 after writing would pass an exit-code-only test.
 */

const GITHUB_DIR = "../../templates/core/skills/board/scripts/github";

/** The exit code `set-field.sh` reserves for "discovery failed — never a label". */
const DISCOVERY_FAILED = 13;
/** "No such field — fall back to a label." Must stay exactly as it was. */
const ABSENT = 10;

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

const PRIORITY_LOCAL = {
  id: "PVTSSF_priority",
  name: "Priority",
  type: "ProjectV2SingleSelectField",
  options: [{ id: "opt_p2", name: "P2" }],
};
const TARGET_DATE_LOCAL = { id: "PVTF_target", name: "Target date", type: "ProjectV2Field" };

interface Stub {
  /** Fields `gh project field-list` reports. */
  fields?: unknown[];
  /** `gh project field-list` fails the way an expired token does. */
  fieldListFails?: boolean;
  /** The detector's own project-node lookup (`project view --format json`) fails. */
  nodeIdFails?: boolean;
  /** Replaces `detect-fields.sh` wholesale — for a discovery that dies mid-emission. */
  detector?: string;
}

async function stubbedProject(stub: Stub): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "set-field-discovery-" });
  const scripts = `${tmp}/board/scripts/github`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });

  for (const name of ["_config.sh", "detect-fields.sh", "set-field.sh"]) {
    await Deno.copyFile(scriptPath(`${GITHUB_DIR}/${name}`), `${scripts}/${name}`);
    await Deno.chmod(`${scripts}/${name}`, 0o755);
  }
  if (stub.detector !== undefined) {
    await Deno.writeTextFile(`${scripts}/detect-fields.sh`, stub.detector);
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
  if [ "${stub.fieldListFails ? 1 : 0}" = 1 ]; then
    echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
    exit 1
  fi
  cat <<'JSON'
${JSON.stringify({ fields: stub.fields ?? [] })}
JSON
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "view" ]; then
  if [[ "\$*" == *"--jq"* ]]; then echo 'PVT_stub'; exit 0; fi
  # The detector's own node lookup is the only call with --format and no --jq;
  # the require_project guard passes neither.
  if [[ "\$*" == *"--format json"* ]] && [ "${stub.nodeIdFails ? 1 : 0}" = 1 ]; then
    echo "HTTP 502: Bad Gateway" >&2
    exit 1
  fi
  echo '{"id":"PVT_stub"}'
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "item-edit" ]; then exit 0; fi
if [ "\$1" = "issue" ] && [ "\$2" = "view" ]; then echo 'I_issuenode'; exit 0; fi
if [ "\$1" = "api" ] && [ "\$2" = "graphql" ]; then
  case "\$*" in
    *setIssueFieldValue*) echo '{"data":{"setIssueFieldValue":{"clientMutationId":null}}}'; exit 0 ;;
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

/** No field value may be written once discovery has failed. */
function assertNothingWritten(calls: string) {
  assert(!calls.includes("item-edit"), `a value was written after discovery failed:\n${calls}`);
  assert(!calls.includes("setIssueFieldValue"), `an issue field was written:\n${calls}`);
}

// ── Discovery fails outright ───────────────────────────────────────────────

for (
  const [axis, value] of [
    ["Priority", "P2"],
    ["TargetDate", "2026-10-01"],
  ] as const
) {
  Deno.test(`${axis}: a failed field-list is reported as a discovery failure, not an absent field`, async () => {
    const tmp = await stubbedProject({
      fields: [PRIORITY_LOCAL, TARGET_DATE_LOCAL],
      fieldListFails: true,
    });
    try {
      const r = await run(tmp, "set-field.sh", ["42", axis, value]);
      assertEquals(
        r.code,
        DISCOVERY_FAILED,
        `expected the discovery-failure exit, got ${r.code} — exit ${ABSENT} tells ` +
          `the caller to write a label beside a native field:\n${r.stderr}`,
      );
      assertStringIncludes(r.stderr, "discovery failed");
      assertStringIncludes(r.stderr, "do not fall back to a label");
      assert(
        !r.stderr.includes("fall back to label"),
        `the absent-field message was printed for a failed lookup:\n${r.stderr}`,
      );
      assertNothingWritten(r.calls);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });
}

// ── Discovery dies part-way through ────────────────────────────────────────

Deno.test("a discovery that dies after emitting some fields is discarded, not half-applied", async () => {
  // The lines that DID arrive name a real field, its organization id and a real
  // option — enough for the issue-field route, which needs no project node id.
  // Evaluating them writes P2 through a discovery the detector itself disowned.
  const partial = `#!/usr/bin/env bash
echo "PRIORITY_FIELD_ID=PVTSSF_priority"
echo "PRIORITY_FIELD_FORM=projected"
echo "PRIORITY_ORG_FIELD_ID=IFSS_priority"
echo "PRIORITY_OPT_P2=IFSSO_p2"
echo "HTTP 403: API rate limit exceeded" >&2
exit 1
`;
  const tmp = await stubbedProject({ fields: [PRIORITY_LOCAL], detector: partial });
  try {
    const r = await run(tmp, "set-field.sh", ["42", "Priority", "P2"]);
    assertEquals(r.code, DISCOVERY_FAILED, `${r.stdout}${r.stderr}`);
    assertNothingWritten(r.calls);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("the detector fails when its project-node lookup fails, rather than emitting it empty", async () => {
  // `echo "PROJECT_NODE_ID=$(gh … | jq …)"` succeeds whatever the substitution
  // does — `echo`'s status is the line's status — so a failed lookup used to
  // leave the detector exiting 0 with an empty id: a failure dressed as data.
  const tmp = await stubbedProject({ fields: [PRIORITY_LOCAL], nodeIdFails: true });
  try {
    const detect = await run(tmp, "detect-fields.sh");
    assert(detect.code !== 0, `the detector reported success:\n${detect.stdout}`);
    assert(
      !detect.stdout.includes("PROJECT_NODE_ID="),
      `an empty project node id was emitted as if it were an answer:\n${detect.stdout}`,
    );

    const r = await run(tmp, "set-field.sh", ["42", "Priority", "P2"]);
    assertEquals(r.code, DISCOVERY_FAILED, `${r.stdout}${r.stderr}`);
    assertNothingWritten(r.calls);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ── The absent-field contract is unchanged ─────────────────────────────────

for (const axis of ["Priority", "TargetDate"] as const) {
  Deno.test(`${axis}: a working discovery that finds no such field still exits ${ABSENT}`, async () => {
    const tmp = await stubbedProject({ fields: [] });
    try {
      const r = await run(tmp, "set-field.sh", ["42", axis, "P2"]);
      assertEquals(r.code, ABSENT, `expected 'no such field', got ${r.code}: ${r.stderr}`);
      assertNothingWritten(r.calls);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  });
}
