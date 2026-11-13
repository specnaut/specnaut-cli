// `run-gate.sh … --sandbox`'s refusals: what it needs, what only it may take, and what runs
// nothing, so no `specnaut sandbox exec` is ever called. The PowerShell twin refuses them all.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { PWSH_AVAILABLE } from "./epic_repo.ts";
import { runGate } from "./run_gate_fixture.ts";
import { sandboxed } from "./run_gate_sandbox_fixture.ts";

Deno.test("run-gate --sandbox: the options it needs, and a head only with it", async () => {
  const { repo, head, objects, evidence, run } = await sandboxed();
  const cases: [string[], string][] = [
    [["--evidence", evidence, "--sandbox"], "--sandbox needs --head <sha>"],
    [["--head", head, "--objects", objects, "--sandbox"], "--sandbox needs --evidence <dir>"],
    [["--head", head, "--objects", objects, "--evidence", evidence], "need --sandbox"],
    [["--evidence", evidence], "--head, --objects and --evidence need --sandbox"],
    [["--head", "-x", "--evidence", evidence, "--sandbox"], "--head takes a value, not -x"],
    [
      ["--head", head, "--objects", "--sandbox", "--evidence", evidence],
      "--objects takes a value, not --sandbox",
    ],
    [["--head", head, "--evidence", "review", "--sandbox"], "--evidence takes an absolute folder"],
    [["--head"], "--head takes a value"],
    [["--evidence", "", "--sandbox"], "--evidence takes a value"],
  ];
  for (const [extra, why] of cases) {
    const r = await run(["fast", "--base", repo.main, ...extra]);
    assertEquals(r.code, 2, extra.join(" "));
    assertStringIncludes(r.stderr, why);
    assertEquals(r.calls, [], extra.join(" "));
  }
});

Deno.test("run-gate --sandbox: --base is checked first, before the head and the evidence", async () => {
  const { evidence, run } = await sandboxed();
  for (const extra of [["--sandbox"], ["--evidence", evidence, "--sandbox"]]) {
    const r = await run(["fast", ...extra]);
    assertEquals([r.code, r.calls], [2, []], extra.join(" "));
    assertStringIncludes(r.stderr, "--sandbox needs --base <rev>");
  }
  assertEquals([...Deno.readDirSync(evidence)], [], "no log folder was made");
});

Deno.test("run-gate --sandbox: a head out of reach, or evidence beside it, runs nothing", async () => {
  const { repo, head, objects, evidence, run } = await sandboxed();
  const base = ["--base", repo.main];
  const unreached = await run([
    "fast",
    ...base,
    "--head",
    head,
    "--evidence",
    evidence,
    "--sandbox",
  ]);
  assertEquals(unreached.code, 3, unreached.stderr);
  assertStringIncludes(
    unreached.stdout,
    `candidate: refused (head-refused: no commit ${head} in reach)`,
  );
  const beside = bashPath(join(dirname(dirname(objects)), "review"));
  await Deno.mkdir(beside);
  const inside = await run([
    "fast",
    ...base,
    "--head",
    head,
    "--objects",
    objects,
    "--evidence",
    beside,
    "--sandbox",
  ]);
  assertEquals(inside.code, 2, inside.stderr);
  assertStringIncludes(inside.stderr, "--evidence lies inside the head's repository");
  assertEquals([unreached.calls, inside.calls], [[], []]);
});

Deno.test({
  name: "run-gate.ps1: static only, it refuses every sandboxed run's option with exit 5",
  ignore: !PWSH_AVAILABLE,
  fn: async () => {
    const { repo, head, objects, evidence } = await sandboxed();
    for (
      const extra of [["--sandbox"], ["--head", head], ["--objects", objects], [
        "--evidence",
        evidence,
      ]]
    ) {
      const r = await runGate("pwsh", repo.root, ["fast", "--base", repo.main, ...extra]);
      assertEquals(r.code, 5, extra.join(" "));
      assertStringIncludes(r.stderr, "static only");
      assertEquals(r.stdout, "", extra.join(" "));
    }
  },
});
