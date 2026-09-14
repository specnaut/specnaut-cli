import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * cli#600 — a single-select field with no project-local options must not abort
 * the detector.
 *
 * `detect-fields.sh` assumes every field `gh project field-list` reports as
 * `ProjectV2SingleSelectField` carries an `options[]` array. An
 * organization-level issue field *projected* into a Project V2 is reported with
 * that same `type` but with `options` null or absent. Two of `emit()`'s three
 * `.options` expressions cannot iterate null, so under `set -euo pipefail` the
 * script dies with jq's exit 5 — and it dies **mid-emission**, part-way through
 * the fields.
 *
 * That is why these assert on the *whole* env block and not on an error
 * message. The script's contract is `eval "$(detect-fields.sh)"`, so a caller
 * does not see the abort: it sees a shell in which some fields are set, the
 * ones after the bad field are silently missing, and nothing said so. The
 * grooming path (`detect-fields.sh` feeding `set-field.sh`) then cannot
 * complete on such a board at all.
 *
 * So the load-bearing assertion in the null case is on a field emitted **after**
 * the bad one — `SIZE_FIELD_ID`. Its presence is the only thing that
 * distinguishes "survived the null field" from "died on it", and a test that
 * only checked the exit code would pass the moment someone added `|| true`
 * without emitting anything.
 */

const GITHUB_DIR = "../../templates/core/skills/board/scripts/github";

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

/** A single-select field as `gh project field-list` reports it. */
function localField(id: string, name: string, options: [string, string][]) {
  return {
    id,
    name,
    type: "ProjectV2SingleSelectField",
    options: options.map(([oid, oname]) => ({ id: oid, name: oname })),
  };
}

const PRIORITY_LOCAL = localField("F_prio", "Priority", [
  ["opt_p0", "P0"],
  ["opt_p1", "P1"],
]);
const SIZE_LOCAL = localField("F_size", "Size", [["opt_s", "S"]]);
/** A "In progress" option proves the non-identifier fold is still applied. */
const STATUS_LOCAL = localField("F_status", "Status", [
  ["opt_backlog", "Backlog"],
  ["opt_wip", "In progress"],
]);

/**
 * Lays the github scripts out so `_config.sh` resolves a project root three
 * levels up, and puts a stub `gh` first on PATH.
 */
async function stubbedProject(fields: unknown[]): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "detect-fields-null-" });
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

  await Deno.writeTextFile(
    `${tmp}/bin/gh`,
    `#!/usr/bin/env bash
if [ "\$1" = "auth" ]; then exit 0; fi
if [ "\$1" = "project" ] && [ "\$2" = "field-list" ]; then
  cat <<'JSON'
${JSON.stringify({ fields })}
JSON
  exit 0
fi
if [ "\$1" = "project" ] && [ "\$2" = "view" ]; then
  # With --jq the real gh prints the bare value, not the object.
  if [[ "\$*" == *"--jq"* ]]; then echo 'PVT_stub'; else echo '{"id":"PVT_stub"}'; fi
  exit 0
fi
echo "unexpected gh invocation: \$*" >&2
exit 1
`,
  );
  await Deno.chmod(`${tmp}/bin/gh`, 0o755);
  return tmp;
}

/**
 * Runs the detector the way its own usage line says to — through `eval` — and
 * reports the variables a caller would actually end up holding.
 *
 * Asserting on the evaluated shell rather than on raw stdout is deliberate: the
 * contract is "these variables are set", and a partially-written env block is
 * indistinguishable from a complete one by reading text.
 */
async function detect(tmp: string) {
  const probe = [
    'out="$("$0/board/scripts/github/detect-fields.sh")"',
    "rc=$?",
    'eval "$out"',
    'echo "rc=$rc"',
    "for v in PRIORITY_FIELD_ID PRIORITY_OPT_NAMES PRIORITY_FIRST_OPT_ID \\",
    "         SIZE_FIELD_ID SIZE_OPT_NAMES STATUS_OPT_IN_PROGRESS; do",
    '  echo "$v=[${!v-<unset>}]"',
    "done",
    // The detector's own stdout, verbatim, so an assertion can look at the
    // lines it emitted rather than at the probe's rendering of them.
    'echo "---EMITTED---"',
    'echo "$out"',
  ].join("\n");

  const { stdout, stderr } = await new Deno.Command("bash", {
    args: ["-c", probe, tmp],
    env: { PATH: `${tmp}/bin:${Deno.env.get("PATH")}` },
    clearEnv: false,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const text = new TextDecoder().decode(stdout);
  const vars = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=\[(.*)\]$/);
    if (m) vars.set(m[1], m[2]);
  }
  return {
    /** The detector's own exit code, not the probe's. */
    rc: Number(text.match(/^rc=(\d+)$/m)?.[1] ?? -1),
    vars,
    /** The lines the detector itself printed. */
    emitted: text.split("---EMITTED---")[1]?.trim().split("\n") ?? [],
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("a project-local single-select is detected with its full option set", async () => {
  const tmp = await stubbedProject([STATUS_LOCAL, PRIORITY_LOCAL, SIZE_LOCAL]);
  try {
    const r = await detect(tmp);
    assertEquals(r.rc, 0, `detect-fields.sh exited ${r.rc}\n${r.stderr}`);
    assertEquals(r.vars.get("PRIORITY_FIELD_ID"), "F_prio");
    assertEquals(r.vars.get("PRIORITY_OPT_NAMES"), "P0, P1");
    assertEquals(r.vars.get("PRIORITY_FIRST_OPT_ID"), "opt_p0");
    // The non-identifier fold: "In progress" must arrive as an assignable name.
    assertEquals(r.vars.get("STATUS_OPT_IN_PROGRESS"), "opt_wip");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a projected field reporting options: null does not abort the detector", async () => {
  // The shape an organization issue field takes when projected into a project.
  const projected = {
    id: "F_prio",
    name: "Priority",
    type: "ProjectV2SingleSelectField",
    options: null,
  };
  const tmp = await stubbedProject([STATUS_LOCAL, projected, SIZE_LOCAL]);
  try {
    const r = await detect(tmp);

    assertEquals(
      r.rc,
      0,
      `detect-fields.sh aborted on a projected field, so the whole grooming ` +
        `path is unavailable on such a board.\n${r.stderr}`,
    );

    // THE assertion. `Size` is emitted AFTER `Priority`; holding it is the only
    // evidence the script got past the null field rather than dying on it.
    assertEquals(
      r.vars.get("SIZE_FIELD_ID"),
      "F_size",
      "the detector never reached Size — it died on the projected Priority, " +
        "and `eval` left the caller with a half-written environment",
    );

    // The projected field is reported as present-but-optionless, coherently:
    // every one of its three variables is set, and all three agree it has no
    // options. A caller must not find one of them missing.
    assertEquals(r.vars.get("PRIORITY_FIELD_ID"), "F_prio");
    assertEquals(r.vars.get("PRIORITY_OPT_NAMES"), "", "option names must be empty, not unset");
    assertEquals(
      r.vars.get("PRIORITY_FIRST_OPT_ID"),
      "",
      "first option id must be empty, not unset",
    );
    // No per-option assignment at all. `PRIORITY_OPT_NAMES` is the summary
    // variable, not an option, so it is excluded by name — an earlier version
    // of this assertion used a substring test and matched itself.
    assertEquals(
      r.emitted.filter((l) => /^PRIORITY_OPT_/.test(l) && !l.startsWith("PRIORITY_OPT_NAMES=")),
      [],
      "a field with no options must emit no per-option assignments",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("a single-select with no options key at all behaves the same", async () => {
  // `options` absent is a distinct JSON shape from `options: null`, and jq
  // treats them alike only because a missing key yields null. Pinned so a
  // future `has("options")` guard cannot fix one and miss the other.
  const projected = { id: "F_prio", name: "Priority", type: "ProjectV2SingleSelectField" };
  const tmp = await stubbedProject([STATUS_LOCAL, projected, SIZE_LOCAL]);
  try {
    const r = await detect(tmp);
    assertEquals(r.rc, 0, `detect-fields.sh aborted on an absent options key\n${r.stderr}`);
    assertEquals(r.vars.get("SIZE_FIELD_ID"), "F_size");
    assertEquals(r.vars.get("PRIORITY_OPT_NAMES"), "");
    assertEquals(r.vars.get("PRIORITY_FIRST_OPT_ID"), "");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
