// `smoke_rm_sweep` (scripts/smoke/_rm_sweep.sh) holds every `rm -rf` in the
// smoke scripts to a vetted path: one delete per line, one quoted variable as
// its whole argument list, and every assignment of that variable a
// scenario_dir, a fresh `mktemp -d` or `""`. smoke-toolbox.sh runs it on the
// suite; these tests run it on fixture directories, and once on the suite.
//
// Every refusal is asserted by the exact line the sweep prints for it, so a
// sweep that failed for another reason cannot pass for the one under test.
//
// Ignored on Windows: a test of shell text, which Git Bash would read the same.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SMOKE = fromFileUrl(new URL("../../scripts/smoke/", import.meta.url));
const ignore = Deno.build.os === "windows";
const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";
const CLEAN = "✓ every rm -rf in the toolbox targets a validated path";

type Result = { code: number; out: string };

/** Runs the sweep, as smoke-toolbox.sh does, on `dir`. */
async function sweep(dir: string): Promise<Result> {
  const { code, stdout, stderr } = await new Deno.Command(BASH, {
    args: [
      "-c",
      'set -uo pipefail; . "$1/_common.sh"; . "$1/_rm_sweep.sh"; smoke_rm_sweep "$2"; finish SWEEP',
      "sweep",
      SMOKE,
      dir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

/** The sweep's result on a directory holding one script, `fx.sh`, with `body`. */
async function sweepOf(body: string): Promise<Result & { file: string }> {
  const dir = await Deno.makeTempDir({ prefix: "rm-sweep-" });
  try {
    const file = join(dir, "fx.sh");
    await Deno.writeTextFile(file, "#!/usr/bin/env bash\n" + body);
    return { ...(await sweep(dir)), file };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const VETTED = 'A=$(scenario_dir "$1")\n';

Deno.test("every vetted form passes, each with its own line", { ignore }, async () => {
  const r = await sweepOf(
    VETTED +
      'rm -rf "$A"\n' +
      'B="$(mktemp -d "${TMPDIR:-/tmp}/fx.XXXXXX")" || B=""\n' +
      "trap 'rm -rf -- \"$B\"' EXIT\n" +
      'C=""\nC=$(mktemp -d)\n[ -n "$C" ] && rm -rf -- "$C" || true\n' +
      'rm -rf "$SANDBOX_ROOT"\n' +
      "# rm -rf / is a comment, not a delete\n",
  );
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, CLEAN);
  for (const v of ["A", "B", "C"]) {
    assertStringIncludes(r.out, `✓ fx.sh builds $${v} through scenario_dir or mktemp -d\n`);
  }
  assertStringIncludes(r.out, "✓ fx.sh takes $SANDBOX_ROOT from _common.sh, unassigned\n");
});

/** Refused at the line: [what, the line, the fixture]. */
const UNVETTED: Array<[string, string, string]> = [
  ["a second argument", 'rm -rf "$A" /etc', VETTED],
  ["a path built past the variable", 'rm -rf "$A"/sub', VETTED],
  ["an unquoted variable", "rm -rf $A", VETTED],
  ["a literal path", "rm -rf /tmp/fx", ""],
];

for (const [what, line, before] of UNVETTED) {
  Deno.test(`a delete with ${what} is refused at its line`, { ignore }, async () => {
    const r = await sweepOf(before + line + "\n");
    assert(r.code !== 0, r.out);
    const at = before === "" ? 2 : 3;
    assertStringIncludes(r.out, `❌ ${r.file}:${at} deletes an unvetted path — ${line}\n`);
    assert(!r.out.includes(CLEAN), r.out);
  });
}

Deno.test("two deletes on one line are refused, though each is vetted", { ignore }, async () => {
  const r = await sweepOf(VETTED + 'rm -rf "$A"; rm -rf "$A"\n');
  assert(r.code !== 0, r.out);
  assertStringIncludes(r.out, `❌ ${r.file}:3 holds 2 deletes on one line — `);
  assert(!r.out.includes(CLEAN), r.out);
});

/** Refused at the variable: [what, the fixture, the variable]. */
const UNVETTED_VARIABLE: Array<[string, string, string]> = [
  ["reassigned inline after a vetted assignment", VETTED + 'cd /; A=/etc\nrm -rf "$A"\n', "A"],
  [
    "reassigned as a local",
    VETTED + 'f() { local x=1 A=$HOME\n  rm -rf -- "$A"\n}\n',
    "A",
  ],
  ["never assigned in its file", 'rm -rf "$FROM_THE_ENVIRONMENT"\n', "FROM_THE_ENVIRONMENT"],
  [
    "SANDBOX_ROOT, assigned outside _common.sh even to a fresh directory",
    'SANDBOX_ROOT=$(mktemp -d)\nrm -rf "$SANDBOX_ROOT"\n',
    "SANDBOX_ROOT",
  ],
  ["built by a plain mktemp, a file", 'A=$(mktemp)\nrm -rf "$A"\n', "A"],
];

for (const [what, body, v] of UNVETTED_VARIABLE) {
  Deno.test(`a variable ${what} is refused`, { ignore }, async () => {
    const r = await sweepOf(body);
    assert(r.code !== 0, r.out);
    assertStringIncludes(r.out, CLEAN, "the line itself was vetted");
    assertStringIncludes(
      r.out,
      `❌ fx.sh assigns $${v} other than through scenario_dir or mktemp -d — `,
    );
  });
}

Deno.test("the suite's own scripts pass, _common.sh and this sweep's file included", {
  ignore,
}, async () => {
  const r = await sweep(SMOKE);
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, CLEAN);
  // _common.sh is read now: its one delete is vetted, by name.
  assertStringIncludes(r.out, "✓ _common.sh builds $tmp through scenario_dir or mktemp -d\n");
});
