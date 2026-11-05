// SC-001 of spec 061: what `run-gate` prints and exits today, pinned on both
// twins before anything behind a flag is built. The bare path is a public
// interface other projects call: its stdout is compared whole, byte for byte,
// so a stray line, a changed character or a reordered header turns this red.
//
// Every command here is a plain `echo`, or `bash -c` where a twin's shell would
// spell the thing differently: the twins share a test only where they agree.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { pwshRunsOnCi } from "./epic_repo.ts";
import { gateProject, gitIn, lf, runGate, TWINS } from "./run_gate_fixture.ts";

pwshRunsOnCi("run-gate");

const GATES = `# a comment
fast_gate:
  # a comment in the section
  - echo one

  - "echo two"
  - 'echo three'
full_gate:
  - echo four
other_key: stays out
`;

for (const twin of TWINS) {
  Deno.test(`run-gate (${twin}): a passing tier prints exactly this`, async () => {
    const r = await runGate(twin, await gateProject(GATES), ["fast"]);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      lf(r.stdout),
      `running the fast gate — 3 command(s) from gates.yml
  [1/3] echo one
one
  [2/3] echo two
two
  [3/3] echo three
three
✓ the fast gate passed — 3 of 3 command(s)
`,
    );
  });

  Deno.test(`run-gate (${twin}): the section ends at the next top-level key`, async () => {
    const r = await runGate(twin, await gateProject(GATES), ["full"]);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      lf(r.stdout),
      `running the full gate — 1 command(s) from gates.yml
  [1/1] echo four
four
✓ the full gate passed — 1 of 1 command(s)
`,
    );
  });

  Deno.test(`run-gate (${twin}): a failing command stops the tier, exit 1`, async () => {
    const gates = `fast_gate:
  - echo before
  - git this-subcommand-does-not-exist
  - echo after
`;
    const r = await runGate(twin, await gateProject(gates), ["fast"]);
    assertEquals(r.code, 1, r.stdout);
    const out = lf(r.stdout);
    assertStringIncludes(out, "  [2/3] git this-subcommand-does-not-exist\n");
    assert(!out.includes("after"), out);
    assert(!out.includes("passed"), out);
    assertStringIncludes(r.stderr, "the fast gate failed at command 2/3 (exit 1)");
  });

  Deno.test(`run-gate (${twin}): no gates.yml is not a failure, and says nothing ran`, async () => {
    const root = await gateProject();
    const r = await runGate(twin, root, ["full"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(lf(r.stdout), "no full gate declared — ");
    assertStringIncludes(lf(r.stdout), "gates.yml is absent, so nothing ran\n");
    assertEquals(lf(r.stdout).split("\n").length, 2, r.stdout);
  });

  Deno.test(`run-gate (${twin}): an empty list is not a failure, and says nothing ran`, async () => {
    const r = await runGate(twin, await gateProject("fast_gate:\nfull_gate:\n"), ["fast"]);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      lf(r.stdout),
      "no fast gate declared — fast_gate in gates.yml is empty, so nothing ran\n",
    );
  });

  Deno.test(`run-gate (${twin}): no tier, or an unknown one, is a usage error`, async () => {
    const root = await gateProject(GATES);
    for (const args of [[], ["slow"]]) {
      const r = await runGate(twin, root, args);
      assertEquals(r.code, 2, r.stdout);
      assertEquals(r.stdout, "");
      assertStringIncludes(r.stderr, "<fast|full>");
    }
  });

  Deno.test(`run-gate (${twin}): a command runs from the repository root, and a cd does not stay`, async () => {
    const gates = `fast_gate:
  - cd .specnaut
  - git rev-parse --show-prefix
`;
    const root = await gateProject(gates);
    await gitIn(root, "init", "-q");
    const r = await runGate(twin, root, ["fast"]);
    assertEquals(r.code, 0, r.stderr);
    assert(!lf(r.stdout).includes(".specnaut/\n"), r.stdout);
    assertStringIncludes(lf(r.stdout), "✓ the fast gate passed — 2 of 2 command(s)\n");
  });

  // #745: in the bash twin the commands ran inside a loop fed by a here-doc, so a
  // command reading stdin consumed the rest of the list, and the tier printed
  // "N of N" and exited 0 with those commands never run. The PowerShell twin
  // cannot lose its list, but its commands inherited the caller's stdin, so one
  // reading it took the caller's data or waited on a terminal. The command that
  // runs after the reader is a failing one: only a list still intact can show
  // it, and the file holds what the reader found.
  Deno.test(`run-gate (${twin}): a stdin-reading command does not skip a later failing one`, async () => {
    const gates = `fast_gate:
  - bash -c 'cat > "$STDIN_SEEN"'
  - git this-subcommand-does-not-exist
  - echo never
`;
    const root = await gateProject(gates);
    const seen = bashPath(join(root, "stdin-seen"));
    const r = await runGate(twin, root, ["fast"], {
      stdin: "data the caller piped in\n",
      env: { STDIN_SEEN: seen },
    });
    assertEquals(r.code, 1, r.stdout);
    assertStringIncludes(lf(r.stdout), "  [2/3] git this-subcommand-does-not-exist\n");
    assertStringIncludes(r.stderr, "the fast gate failed at command 2/3");
    assert(!lf(r.stdout).includes("passed"), r.stdout);
    assertEquals(await Deno.readTextFile(join(root, "stdin-seen")), "");
  });

  Deno.test(`run-gate (${twin}): a stdin-reading command is not handed the caller's stdin`, async () => {
    const gates = `fast_gate:
  - bash -c 'cat > "$STDIN_SEEN"'
  - echo later
`;
    const root = await gateProject(gates);
    const r = await runGate(twin, root, ["fast"], {
      stdin: "data the caller piped in\n",
      env: { STDIN_SEEN: bashPath(join(root, "stdin-seen")) },
    });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await Deno.readTextFile(join(root, "stdin-seen")), "");
    assertStringIncludes(lf(r.stdout), "\nlater\n");
    assertStringIncludes(lf(r.stdout), "✓ the fast gate passed — 2 of 2 command(s)\n");
  });
}

// Found while checking the twin for #745. Its comment said a failing cmdlet was a
// failure, but Invoke-Expression succeeds whenever its argument parses, so the
// tier went on and printed "passed" over the failure. And an `exit` in a command
// ended run-gate itself, with no sentence saying what failed.
if (TWINS.includes("pwsh")) {
  Deno.test("run-gate (pwsh): a failing cmdlet fails the tier", async () => {
    const gates = "fast_gate:\n  - Get-Item /no/such/path/at/all\n  - echo never\n";
    const r = await runGate("pwsh", await gateProject(gates), ["fast"]);
    assertEquals(r.code, 1, r.stdout);
    assertStringIncludes(r.stderr, "the fast gate failed at command 1/2 (exit 1)");
    assert(!lf(r.stdout).includes("[2/2]"), r.stdout);
    assert(!lf(r.stdout).includes("passed"), r.stdout);
  });

  Deno.test("run-gate (pwsh): an exit in a command fails that command, not the script", async () => {
    const gates = "fast_gate:\n  - exit 3\n  - echo never\n";
    const r = await runGate("pwsh", await gateProject(gates), ["fast"]);
    assertEquals(r.code, 1, r.stdout);
    assertStringIncludes(r.stderr, "the fast gate failed at command 1/2 (exit 3)");
  });

  Deno.test("run-gate (pwsh): a native failure followed by a cmdlet still fails", async () => {
    const gates = "fast_gate:\n  - git this-subcommand-does-not-exist; echo after\n";
    const r = await runGate("pwsh", await gateProject(gates), ["fast"]);
    assertEquals(r.code, 1, r.stdout);
    assertStringIncludes(r.stderr, "the fast gate failed at command 1/1 (exit 1)");
  });

  Deno.test("run-gate (pwsh): an exit 0 in a command does not end the tier early", async () => {
    const gates = "fast_gate:\n  - exit 0\n  - echo reached\n";
    const r = await runGate("pwsh", await gateProject(gates), ["fast"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(lf(r.stdout), "\nreached\n");
    assertStringIncludes(lf(r.stdout), "2 of 2 command(s)\n");
  });
}
