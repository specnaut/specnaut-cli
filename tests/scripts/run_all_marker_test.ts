// `run-all.sh` passes a smoke script only when it reached its verdict (cli#748).
//
// On macOS's /bin/bash 3.2, a script under `set -e` that dies on an unset
// variable while an EXIT trap is set exits with the trap's status, which is 0
// for a cleanup that succeeded. Its exit code alone reads as a pass, so a pass
// is exit 0 and a marker holding the script's own name, written by `finish`
// (or by audit.sh at its clean exit) through `_common.sh`.
//
// The seam: the real `run-all.sh` and every `_*.sh` helper (`_common.sh` and what it sources),
// copied byte for byte into a throwaway `scripts/smoke/`. A fixture takes the name of an existing
// suite member, so the membership list is not edited. `--no-bundle` keeps the tracked bundle
// untouched; the one test that bundles runs a `deno` shim in a throwaway tree. The bash under test
// is /bin/bash on macOS, the one with the defect, and the PATH's bash elsewhere. A `bash` shim for
// it goes first on PATH, because `run-all.sh` starts each member as `bash <script>`. Every fixture
// prints its BASH_VERSINFO, so a run that picked up another bash cannot pass for a run on 3.2.
//
// Ignored on Windows: the defect is bash 3.2's, which no Windows runner ships,
// and the shims rely on a POSIX `#!/bin/sh` script being runnable by name.

import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SMOKE = fromFileUrl(new URL("../../scripts/smoke/", import.meta.url));
const ignore = Deno.build.os === "windows";
const onMac = Deno.build.os === "darwin";
const BASH = onMac ? "/bin/bash" : "bash";
/** A suite member's name, borrowed: `--only` accepts nothing outside SUITE_FILES. */
const MEMBER = "smoke-task.sh";
const PASSED = "═══ SUITE: ALL CHECKS PASSED ═══";
const aborted = (script: string) => `❌ ${script} — aborted before its verdict`;

/** A member's opening lines: its mode, the shared header, its bash version. */
const head = (mode: string) =>
  [
    "#!/usr/bin/env bash",
    `set ${mode}`,
    'echo "fixture was handed ${SMOKE_DONE:-no marker}"',
    '. "$(dirname "$0")/_common.sh"',
    'echo "fixture bash ${BASH_VERSINFO[0]}"',
  ].join("\n") + "\n";

const REACHES_VERDICT = head("-euo pipefail") + 'pass "a check"\nfinish "FIXTURE"\n';
/** The 3.2 defect itself: an unset variable, an EXIT trap whose cleanup succeeds. */
const DIES = "trap 'rm -f -- \"${TMPDIR:-/tmp}/run-all-marker-nothing\"' EXIT\n" +
  ': "$FIXTURE_UNSET_VAR"\nfinish "FIXTURE"\n';
const DIES_UNDER_TRAP = head("-euo pipefail") + DIES;
const EXITS_0_EARLY = head("-euo pipefail") + 'pass "a check"\nexit 0\nfinish "FIXTURE"\n';
/** How a same-named child's or a subshell's verdict is followed: an abort, or a bare exit 0. */
const ENDINGS = { "dies under a trap": DIES, "exits 0": "exit 0\n" } as const;

const auditStub = (marks: boolean) =>
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    '. "$(dirname "$0")/_common.sh"',
    'echo "audit stub bash ${BASH_VERSINFO[0]}"',
    marks ? "smoke_mark_verdict; exit 0" : "exit 0",
  ].join("\n") + "\n";
const AUDIT_OK = auditStub(true);

type Result = { code: number; out: string };
type Suite = { root: string; smoke: string; tmp: string };

/** A shim at `<root>/bin/<name>` running `body`, ahead of the real one on PATH. */
async function shim(root: string, name: string, body: string) {
  await Deno.writeTextFile(join(root, "bin", name), `#!/bin/sh\n${body}\n`);
  await Deno.chmod(join(root, "bin", name), 0o755);
}

/**
 * Runs `body` on a throwaway suite holding `member`, `audit`, and any `extra`
 * files (by path under scripts/smoke/), and removes the suite afterwards.
 */
async function withSuite(
  member: string,
  audit: string,
  body: (s: Suite) => Promise<void>,
  extra: Record<string, string> = {},
) {
  const root = await Deno.makeTempDir({ prefix: "run-all-marker-" });
  try {
    const smoke = join(root, "scripts", "smoke");
    await Deno.mkdir(join(smoke, "nested"), { recursive: true });
    for await (const { name } of Deno.readDir(SMOKE)) {
      if (/^(run-all|_.*)\.sh$/.test(name)) {
        await Deno.copyFile(join(SMOKE, name), join(smoke, name));
      }
    }
    const files = { [MEMBER]: member, "audit.sh": audit, ...extra };
    for (const [path, content] of Object.entries(files)) {
      await Deno.writeTextFile(join(smoke, path), content);
    }
    const resolved = onMac
      ? BASH
      : (await runIn(root, "bash", ["-c", "command -v bash"])).out.trim();
    await Deno.mkdir(join(root, "bin"));
    await shim(root, "bash", `exec '${resolved}' "$@"`);
    await Deno.mkdir(join(root, "tmp"));
    await body({ root, smoke, tmp: join(root, "tmp") });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function runIn(root: string, bin: string, args: string[]): Promise<Result> {
  const { code, stdout, stderr } = await new Deno.Command(bin, {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
    env: {
      PATH: `${join(root, "bin")}:${Deno.env.get("PATH") ?? ""}`,
      TMPDIR: join(root, "tmp"),
    },
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

/** `run-all.sh [--no-bundle] --only <member>` from the suite, under the bash under test. */
const runAll = (s: Suite, script = "run-all.sh", bundle = false) =>
  runIn(s.root, BASH, [
    join(s.smoke, script),
    ...(bundle ? [] : ["--no-bundle"]),
    "--only",
    MEMBER,
  ]);

/** The fixture ran under the bash this test means: 3.2 on macOS. */
function ranUnderTheRightBash(r: Result) {
  assertMatch(r.out, onMac ? /^fixture bash 3$/m : /^fixture bash \d+$/m, r.out);
}

function failedAsAborted(r: Result, script = MEMBER) {
  assert(r.code !== 0, r.out);
  assertStringIncludes(r.out, `\n${aborted(script)}\n`);
  assert(!r.out.includes(PASSED), r.out);
}

/** An abort fails as aborted on 3.2; bash 4+ keeps the abort's status, so its exit code tells. */
function failedAfter(ending: string, r: Result) {
  if (ending === "exits 0" || onMac) failedAsAborted(r);
  else assert(r.code !== 0 && !r.out.includes(PASSED), r.out);
}

/** `id -u` is 0: a read-only file does not stop root from overwriting it. */
const asRoot = !ignore && new TextDecoder().decode(
      (await new Deno.Command("id", { args: ["-u"], stdout: "piped" }).output()).stdout,
    ).trim() === "0";

Deno.test("a member and an audit that reach their verdicts pass, and the markers are removed", {
  ignore,
}, async () => {
  await withSuite(REACHES_VERDICT, AUDIT_OK, async (s) => {
    const r = await runAll(s);
    assertEquals(r.code, 0, r.out);
    assertStringIncludes(r.out, PASSED);
    assertStringIncludes(r.out, `✓ ${MEMBER}\n`);
    assertStringIncludes(r.out, "✓ audit.sh\n");
    ranUnderTheRightBash(r);
    // The path run-all.sh handed the member, under the TMPDIR it was given.
    const handed = r.out.match(/^fixture was handed (.+)$/m)?.[1] ?? "";
    assert(handed.startsWith(s.tmp) && handed.endsWith(`/${MEMBER}`), r.out);
    assertEquals([...Deno.readDirSync(s.tmp)], [], "the marker directory outlived the run");
  });
});

Deno.test("a member that dies on an unset variable under an EXIT trap fails (3.2)", {
  ignore,
}, async () => {
  await withSuite(DIES_UNDER_TRAP, AUDIT_OK, async (s) => {
    const r = await runAll(s);
    ranUnderTheRightBash(r);
    assertStringIncludes(r.out, "FIXTURE_UNSET_VAR");
    if (onMac) failedAsAborted(r);
    else {
      assert(r.code !== 0, r.out);
      assertMatch(r.out, new RegExp(`^❌ ${MEMBER} — exit [1-9]`, "m"));
      assert(!r.out.includes(PASSED), r.out);
    }
  });
});

Deno.test("a member that exits 0 without its verdict fails: the exit status is not enough", {
  ignore,
}, async () => {
  await withSuite(EXITS_0_EARLY, AUDIT_OK, async (s) => {
    const r = await runAll(s);
    ranUnderTheRightBash(r);
    assertStringIncludes(r.out, `✓ a check\n`);
    failedAsAborted(r);
  });
});

for (const [ending, tail] of Object.entries(ENDINGS)) {
  Deno.test(`a child smoke script of the same name cannot stand in, when the parent ${ending}`, {
    ignore,
  }, async () => {
    const child = "#!/usr/bin/env bash\nset -euo pipefail\n" +
      '. "$(dirname "$0")/../_common.sh"\nfinish "CHILD"\n';
    const parent = head("-euo pipefail") + `bash "$SMOKE_DIR/nested/${MEMBER}"\n` + tail;
    await withSuite(parent, AUDIT_OK, async (s) => {
      const r = await runAll(s);
      ranUnderTheRightBash(r);
      assertStringIncludes(r.out, "═══ CHILD: ALL CHECKS PASSED ═══");
      failedAfter(ending, r);
    }, { [`nested/${MEMBER}`]: child });
  });

  Deno.test(`a verdict reached in a subshell cannot stand in, when the script ${ending}`, {
    ignore,
  }, async () => {
    const member = head("-euo pipefail") + "trap true EXIT\n" + '( finish "INNER" )\n' + tail;
    await withSuite(member, AUDIT_OK, async (s) => {
      const r = await runAll(s);
      ranUnderTheRightBash(r);
      assertStringIncludes(r.out, "═══ INNER: ALL CHECKS PASSED ═══");
      failedAfter(ending, r);
    });
  });
}

Deno.test("an audit.sh that exits 0 without its verdict fails the suite", {
  ignore,
}, async () => {
  await withSuite(REACHES_VERDICT, auditStub(false), async (s) => {
    const r = await runAll(s);
    assertMatch(r.out, onMac ? /^audit stub bash 3$/m : /^audit stub bash \d+$/m, r.out);
    assertStringIncludes(r.out, `✓ ${MEMBER}\n`);
    failedAsAborted(r, "audit.sh");
  });
});

Deno.test("run-all.sh's own abort, after its EXIT trap is set, exits non-zero", {
  ignore,
}, async () => {
  await withSuite(REACHES_VERDICT, AUDIT_OK, async (s) => {
    const source = await Deno.readTextFile(join(s.smoke, "run-all.sh"));
    const anchor = "# --- FR-001: the suite guards its own boundary";
    assertEquals(source.split(anchor).length, 2, "the anchor moved: re-aim this test");
    const token = "run-all-own-abort-5e1d";
    await Deno.writeTextFile(
      join(s.smoke, "aborting-run-all.sh"),
      source.replace(anchor, `echo "${token}"\n: "$RUN_ALL_UNSET_VAR"\n${anchor}`),
    );
    const r = await runAll(s, "aborting-run-all.sh");
    assertMatch(r.out, new RegExp(`^${token}$`, "m"));
    assertStringIncludes(r.out, "RUN_ALL_UNSET_VAR");
    assert(r.code !== 0, r.out);
    assert(!r.out.includes(PASSED), r.out);
    assert(!r.out.includes("fixture bash"), "the member ran: the abort came too late");
  });
});

// The one path where the trap's `exit "$rc"` is all that keeps the status
// non-zero: every check passed, `finish` exits 0, and the bundle cannot be put
// back. Without that line the run would exit 0 with the tracked file left
// regenerated.
Deno.test("a bundle that cannot be restored fails a green run, and its backup is kept", {
  ignore: ignore || asRoot,
}, async () => {
  await withSuite(REACHES_VERDICT, AUDIT_OK, async (s) => {
    const bundle = join(s.root, "src", "templates_bundle.ts");
    await Deno.mkdir(join(s.root, "src"));
    await Deno.writeTextFile(bundle, "// the committed bundle\n");
    // `deno task bundle`, as run-all.sh calls it: leaves the bundle unwritable.
    await shim(s.root, "deno", `chmod 444 '${bundle}'`);
    const r = await runAll(s, "run-all.sh", true);
    ranUnderTheRightBash(r);
    assertStringIncludes(r.out, PASSED);
    const kept = r.out.match(/^run-all\.sh: could not restore .*; the backup is kept at (.+)$/m);
    assert(kept, r.out);
    assertEquals(r.code, 1, r.out);
    assertEquals(await Deno.readTextFile(kept[1]), "// the committed bundle\n");
    assert(kept[1].startsWith(s.tmp), `the backup left the TMPDIR it was given: ${kept[1]}`);
  });
});
