// Regression tests for Project Status placement on issue creation.
//
// `gh project item-add` attaches an item with Status **null** — it does not
// fall back to the first column. A null-Status item is invisible to every
// column-filtered board view AND to any grooming sweep that enumerates the
// columns, because it matches none of them. So a user creates a task through
// the bundled skill, sees a URL, and the task never appears on their board.
//
// The github backend is the only one affected: gitlab places the item at
// creation via a scoped label, and local writes the status into the task
// file's frontmatter. These tests pin all three.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const GITHUB_DIR = "../../templates/core/skills/task/scripts/github";

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(scriptPath(rel));
}

/**
 * Lays out the github scripts so `_config.sh` resolves a project root, drops a
 * backlog-config.yml beside it, and puts a stub `gh` first on PATH. Lets the
 * real script run end to end with no network.
 *
 * `_config.sh` computes ROOT as `dirname($0)/../../..`, so the scripts must sit
 * exactly three levels below the root that holds `.specnaut/`.
 */
async function stubbedProject(fieldListJson: string): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "backlog-status-" });
  const scripts = `${tmp}/board/scripts/github`;
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });

  for (const name of ["_config.sh", "detect-fields.sh"]) {
    await Deno.copyFile(scriptPath(`${GITHUB_DIR}/${name}`), `${scripts}/${name}`);
    await Deno.chmod(`${scripts}/${name}`, 0o755);
  }
  await Deno.writeTextFile(
    `${tmp}/.specnaut/backlog-config.yml`,
    'repo: "acme/my-app"\nproject_number: 7\n',
  );

  // Stub `gh`: field-list returns the fixture, view returns a project node id.
  await Deno.writeTextFile(
    `${tmp}/bin/gh`,
    `#!/usr/bin/env bash
if [ "\$1" = "project" ] && [ "\$2" = "field-list" ]; then
  cat <<'JSON'
${fieldListJson}
JSON
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "view" ]; then
  echo '{"id":"PVT_stub"}'
  exit 0
fi
echo "unexpected gh invocation: \$*" >&2
exit 1
`,
  );
  await Deno.chmod(`${tmp}/bin/gh`, 0o755);
  return tmp;
}

/** A board whose columns include names that are not valid shell identifiers. */
const BOARD_JSON = JSON.stringify(
  {
    fields: [
      {
        id: "F_status",
        name: "Status",
        type: "ProjectV2SingleSelectField",
        options: [
          { id: "opt_backlog", name: "Backlog" },
          { id: "opt_inprog", name: "In progress" },
          { id: "opt_inrev", name: "In review" },
          { id: "opt_done", name: "Done" },
        ],
      },
    ],
  },
  null,
  2,
);

async function runDetectFields(tmp: string): Promise<{ code: number; stdout: string }> {
  const { code, stdout } = await new Deno.Command("bash", {
    args: [`${tmp}/board/scripts/github/detect-fields.sh`],
    env: { PATH: `${tmp}/bin:${Deno.env.get("PATH")}` },
    clearEnv: false,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, stdout: new TextDecoder().decode(stdout) };
}

Deno.test("detect-fields.sh resolves the Status field", async () => {
  const tmp = await stubbedProject(BOARD_JSON);
  const { code, stdout } = await runDetectFields(tmp);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "STATUS_FIELD_ID=F_status");
  assertStringIncludes(stdout, "STATUS_OPT_BACKLOG=opt_backlog");
});

Deno.test("option names that are not identifiers stay evaluable", async () => {
  // "In progress" would emit `STATUS_OPT_IN PROGRESS=…`, which breaks the
  // caller's `eval` — the assignment ends at the space. Non-alphanumerics must
  // be folded to `_`.
  const tmp = await stubbedProject(BOARD_JSON);
  const { stdout } = await runDetectFields(tmp);
  assertStringIncludes(stdout, "STATUS_OPT_IN_PROGRESS=opt_inprog");
  assertStringIncludes(stdout, "STATUS_OPT_IN_REVIEW=opt_inrev");
  assert(
    !/^STATUS_OPT_[A-Z0-9_]* /m.test(stdout),
    "no emitted assignment may contain a space before '='",
  );

  // Round-trip it through a real `eval`, which is how add.sh consumes it.
  const child = new Deno.Command("bash", {
    args: ["-c", `eval "$(cat)" && echo "$STATUS_OPT_IN_PROGRESS"`],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdout));
  await writer.close();
  const { code, stdout: echoed } = await child.output();
  assertEquals(code, 0, "emitted lines must survive eval");
  assertEquals(new TextDecoder().decode(echoed).trim(), "opt_inprog");
});

Deno.test("detect-fields.sh exposes a fallback for boards with no Backlog column", async () => {
  // A scaffolded board belongs to the user and need not have a column called
  // "Backlog"; add.sh degrades to the first column rather than refusing.
  const tmp = await stubbedProject(BOARD_JSON);
  const { stdout } = await runDetectFields(tmp);
  assertStringIncludes(stdout, "STATUS_FIRST_OPT_ID=opt_backlog");
  assertStringIncludes(stdout, "STATUS_OPT_NAMES=");
});

Deno.test("github add.sh places the item and never fails creation", async () => {
  const src = await read(`${GITHUB_DIR}/add.sh`);
  // It must set Status, not merely attach.
  assertStringIncludes(src, "item-edit");
  assertStringIncludes(src, "--single-select-option-id");
  // The issue exists by the time placement runs: a non-zero exit would leave
  // the caller unsure whether anything was created, and a re-run would
  // duplicate it. Every failure path warns and returns 0.
  assertStringIncludes(src, "place_in_backlog || true");
  assert(
    !/exit [1-9]/.test(src.slice(src.indexOf("place_in_backlog()"))),
    "the placement helper must not exit non-zero on any path",
  );
});

Deno.test("github add.sh resolves ids at runtime instead of hardcoding them", async () => {
  // The board belongs to the user, so field and option ids cannot be baked in.
  // The lookup lives in detect-fields.sh — there must be no second copy here.
  const src = await read(`${GITHUB_DIR}/add.sh`);
  assertStringIncludes(src, "detect-fields.sh");
  assert(
    !/PVTSSF_|PVT_kwDO/.test(src),
    "add.sh must not carry a hardcoded project or field id",
  );
  assert(
    !src.includes("field-list"),
    "the Status lookup must not be duplicated into add.sh",
  );
});

Deno.test("the other backends already place items at creation", async () => {
  // Placement is atomic for these, so they have no equivalent defect and were
  // deliberately left untouched.
  const gitlab = await read("../../templates/core/skills/task/scripts/gitlab/add.sh");
  assertStringIncludes(gitlab, "Status::Backlog");

  const local = await read("../../templates/core/skills/task/scripts/local/add.sh");
  assertStringIncludes(local, "status: Backlog");
});
