import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * cli#603 — a project workflow that wins the race must not kill `add.sh`.
 *
 * `add.sh` runs under `set -euo pipefail`. When a board has GitHub's built-in
 * **Auto-add to project** workflow enabled, that workflow races
 * `gh project item-add`; if its insert lands first the API refuses a second
 * one, `gh` exits non-zero, and the script dies **after** `✓ created:` has
 * already printed a working URL.
 *
 * What the user is left with: a real issue, attached to the board by the
 * workflow, with `Status` **null** — matching no column filter, so invisible to
 * every column-filtered view and to every grooming sweep that enumerates
 * columns. The failure reports as a success with a live link.
 *
 * The invariant these tests pin is the one the script's own placement step
 * already stated twelve lines lower and the attach did not:
 *
 * > after `gh issue create` succeeds, nothing downstream may abort the script,
 * > because the issue is real and a re-run duplicates it.
 *
 * They run the REAL script against a stubbed `gh`, because the defect is in
 * control flow under `set -e` — reading the source cannot show whether the
 * process survives.
 */

const GITHUB_DIR = "../../templates/core/skills/board/scripts/github";
const ISSUE_URL = "https://github.com/acme/my-app/issues/42";

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

/**
 * Lays the github scripts out so `_config.sh` resolves a project root three
 * levels up, and puts a stub `gh` first on PATH.
 *
 * `itemAddExit` is the knob: `1` simulates the losing side of the race.
 * `graphqlItemId` is what the board answers when asked whether the item is
 * already there — empty means "not attached".
 */
async function stubbedProject(
  opts: { itemAddExit: number; graphqlItemId: string },
): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "backlog-attach-race-" });
  const scripts = `${tmp}/board/scripts/github`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });

  for (const name of ["_config.sh", "detect-fields.sh", "add.sh"]) {
    await Deno.copyFile(scriptPath(`${GITHUB_DIR}/${name}`), `${scripts}/${name}`);
    await Deno.chmod(`${scripts}/${name}`, 0o755);
  }
  await Deno.writeTextFile(
    `${tmp}/.specnaut/backlog-config.yml`,
    'repo: "acme/my-app"\nproject_number: 7\n',
  );

  const fieldList = JSON.stringify({
    fields: [{
      id: "F_status",
      name: "Status",
      type: "ProjectV2SingleSelectField",
      options: [{ id: "opt_backlog", name: "Backlog" }],
    }],
  });

  await Deno.writeTextFile(
    `${tmp}/bin/gh`,
    `#!/usr/bin/env bash
# Record every call so a test can assert what the script actually attempted.
echo "\$*" >> "${tmp}/gh-calls.log"

if [ "\$1" = "issue" ] && [ "\$2" = "create" ]; then
  echo "${ISSUE_URL}"; exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "item-add" ]; then
  if [ "${opts.itemAddExit}" != "0" ]; then
    echo 'failed to add item: Content already exists in this project' >&2
    exit ${opts.itemAddExit}
  fi
  echo 'PVTI_from_add'; exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "field-list" ]; then
  cat <<'JSON'
${fieldList}
JSON
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "view" ]; then
  # Fidelity matters: with --jq the real gh prints the bare value, not the
  # object. A stub that returns the whole JSON here makes the id compare
  # unequal to itself downstream and the test passes for the wrong reason.
  if [[ "\$*" == *"--jq"* ]]; then echo 'PVT_stub'; else echo '{"id":"PVT_stub"}'; fi
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "item-edit" ]; then exit 0; fi
if [ "\$1" = "api" ] && [ "\$2" = "graphql" ]; then
  # The board's answer to "is this issue already on the project".
  if [ -n "${opts.graphqlItemId}" ]; then
    echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"${opts.graphqlItemId}","project":{"id":"PVT_stub"}}]}}}}}'
  else
    echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[]}}}}}'
  fi
  exit 0
fi
echo "unexpected gh invocation: \$*" >&2
exit 1
`,
  );
  await Deno.chmod(`${tmp}/bin/gh`, 0o755);
  return tmp;
}

async function runAdd(tmp: string) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [`${tmp}/board/scripts/github/add.sh`, "a new task"],
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

Deno.test("a project workflow winning the attach race does not kill add.sh", async () => {
  // The losing side of the race: `item-add` refuses, but the item IS on the
  // board — the workflow put it there.
  const tmp = await stubbedProject({ itemAddExit: 1, graphqlItemId: "PVTI_from_workflow" });
  try {
    const r = await runAdd(tmp);

    assertEquals(
      r.code,
      0,
      `add.sh died after creating the issue. stdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    );
    assertStringIncludes(r.stdout, "already on Project", "the recovery was not reported");

    // THE assertion. Reaching `item-edit` is the only thing that distinguishes
    // "survived and placed the item" from "survived and left it in no column",
    // and the null Status is the whole defect.
    assertStringIncludes(
      r.calls,
      "project item-edit",
      "the script survived but never placed the item — a null Status is " +
        "invisible to every column-filtered view, which is the defect #603 reports",
    );
    assertStringIncludes(r.stdout, "placed in Backlog");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("an attach that fails with the item genuinely absent warns and still exits 0", async () => {
  // The other branch: the add failed AND the board does not have the item.
  // Nothing can place it — but the issue exists, so exiting non-zero would
  // leave the caller unsure whether to re-run, and a re-run duplicates it.
  const tmp = await stubbedProject({ itemAddExit: 1, graphqlItemId: "" });
  try {
    const r = await runAdd(tmp);

    assertEquals(r.code, 0, `add.sh exited ${r.code} after creating a real issue`);
    assertStringIncludes(r.stdout, ISSUE_URL, "the caller was not told the issue exists");
    assertStringIncludes(r.stderr, "could not attach", "the failure was not reported");
    assertStringIncludes(
      r.stderr,
      "nothing to place",
      "placement must say why it did nothing rather than failing on an empty item id",
    );
    assert(
      !r.calls.includes("project item-edit"),
      "there is no item to edit — calling item-edit with an empty id reports the wrong cause",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("the uncontended path is unchanged", async () => {
  const tmp = await stubbedProject({ itemAddExit: 0, graphqlItemId: "" });
  try {
    const r = await runAdd(tmp);
    assertEquals(r.code, 0);
    assertStringIncludes(r.stdout, "attached to Project #7");
    assertStringIncludes(r.stdout, "placed in Backlog");
    // No board lookup when the add succeeds: the recovery must cost nothing on
    // the path that does not need it.
    assert(
      !r.calls.includes("api graphql"),
      "the happy path spent a GraphQL call it did not need",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
