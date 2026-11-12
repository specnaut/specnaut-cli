// `run-gate.sh <tier> … --head <sha> --objects <dir> --evidence <dir> --sandbox`: each command of
// this checkout's gates.yml runs on the head's exported copy through `specnaut sandbox exec`,
// never here, and is judged by its exit code alone. A `specnaut` first on the PATH records each
// call and exits as told, so no sandbox is needed; the project's own commands write a mark when
// they run here, so a run that bypassed the sandbox leaves one. The PowerShell twin is static
// only: it refuses every one of these options.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER, dirname, join } from "@std/path";
import { exportHead } from "./explicit_head_fixture.ts";
import { ALWAYS, impactRepo, SUITE, WEB_ONLY } from "./gate_impact_fixture.ts";
import { PWSH_AVAILABLE } from "./epic_repo.ts";
import { runGate, tempDir } from "./run_gate_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" '<end>' >>"$SANDBOX_CALLS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --log ]; then printf 'what the run printed\\n' >"$2"; fi
  shift
done
exit "$SANDBOX_RC"
`;

/** A project on `feature` with a dirty work tree, a head exported beside it, and a `specnaut`. */
async function sandboxed(opts: Parameters<typeof impactRepo>[0] = {}) {
  const repo = await impactRepo(opts);
  const { head, objects } = await exportHead(repo.root, { "apps/web/a.ts": "the head's web\n" });
  await Deno.writeTextFile(join(repo.root, "apps/api/a.ts"), "an uncommitted edit\n");
  const bin = await tempDir("run-gate-bin-");
  await Deno.writeTextFile(join(bin, "specnaut"), STUB);
  if (Deno.build.os !== "windows") await Deno.chmod(join(bin, "specnaut"), 0o755);
  const evidence = bashPath(await tempDir("run-gate-review-"));
  const key = Object.keys(Deno.env.toObject()).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const calls = join(bin, "calls");
  const run = async (args: string[], rc = 0) => {
    await Deno.remove(calls).catch(() => undefined);
    const env = {
      [key]: `${bin}${DELIMITER}${Deno.env.get("PATH") ?? ""}`,
      SANDBOX_CALLS: bashPath(calls),
      SANDBOX_RC: String(rc),
    };
    const r = await repo.gate("bash", args, { env });
    const text = await Deno.readTextFile(calls).catch(() => "");
    const said = text.replaceAll("\r", "").split("<end>\n").filter(Boolean);
    return { ...r, calls: said.map((c) => c.split("\n").slice(0, -1)) };
  };
  const full = ["--head", head, "--objects", objects, "--evidence", evidence, "--sandbox"];
  return { repo, head, objects, evidence, run, full };
}

/** The one evidence file a run wrote under `folder`. */
const evidenceOf = async (folder: string) => {
  const dir = join(folder, "specnaut/gate-evidence");
  const names = [...Deno.readDirSync(dir)].map((e) => e.name);
  assertEquals(names.length, 1, names.join(" "));
  assert(names[0].startsWith("fast-"), names[0]);
  return JSON.parse(await Deno.readTextFile(join(dir, names[0])));
};

Deno.test("run-gate --sandbox: each configured command runs on the head in the sandbox, never here", async () => {
  const { repo, head, evidence, run, full } = await sandboxed();
  const r = await run(["fast", "--base", repo.main, ...full]);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.marks, [], "a command ran on the host");
  const logs = dirname(r.calls[0]?.[4] ?? "");
  assert(logs.startsWith(`${evidence}/gate-fast.`), logs);
  assertEquals(
    r.calls,
    [SUITE, WEB_ONLY, ALWAYS].map((cmd, i) => [
      "sandbox",
      "exec",
      head,
      "--log",
      `${logs}/${i + 1}.log`,
      "--",
      "sh",
      "-c",
      cmd,
    ]),
  );
  assertEquals(await Deno.readTextFile(`${logs}/3.log`), "what the run printed\n");
  assertStringIncludes(r.stdout, `log: ${logs}/1.log`);
  const written = await evidenceOf(evidence);
  assertEquals([written.commit, written.result, written.valid], [head, "passed", true]);
});

Deno.test("run-gate --sandbox: 125 or 127 from the sandbox is NOT RUN, never a pass; another exit fails", async () => {
  const { repo, evidence, run, full } = await sandboxed();
  for (const rc of [125, 127]) {
    const notRun = await run(["fast", "--base", repo.main, ...full], rc);
    assertEquals(notRun.code, 125, notRun.stderr);
    assertEquals(notRun.calls.length, 1, "the tier went on after nothing ran");
    assertStringIncludes(notRun.stderr, `(exit ${rc}): ${SUITE}`);
    assertStringIncludes(notRun.stderr, "NOT RUN, never a pass");
    assert(!notRun.stdout.includes("passed"), notRun.stdout);
    assertEquals((await evidenceOf(evidence)).result, "not_run");
  }
  const failed = await run(["fast", "--base", repo.main, ...full], 3);
  assertEquals(failed.code, 1, failed.stderr);
  assertStringIncludes(failed.stderr, "the fast gate failed at command 1/3 (exit 3)");
});

Deno.test("run-gate --sandbox: with no declaration, the bare run goes through the sandbox too", async () => {
  const { run, full } = await sandboxed({ declaration: null });
  const r = await run(["fast", ...full]);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.marks, [], "a command ran on the host");
  assertEquals(r.calls.map((c) => c.at(-1)), [SUITE, WEB_ONLY, ALWAYS]);
  for (const rc of [125, 127]) {
    const notRun = await run(["fast", ...full], rc);
    assertEquals(notRun.code, 125, notRun.stdout);
    assertEquals(notRun.calls.length, 1);
    assertStringIncludes(
      notRun.stderr,
      `the fast gate did not run at command 1/3 (exit ${rc}): ${SUITE}`,
    );
  }
});

Deno.test("run-gate --sandbox: the options it needs, and a head only with it", async () => {
  const { repo, head, objects, evidence, run } = await sandboxed();
  const cases: [string[], string][] = [
    [["--evidence", evidence, "--sandbox"], "--sandbox needs --head <sha>"],
    [["--head", head, "--objects", objects, "--sandbox"], "--sandbox needs --evidence <dir>"],
    [["--head", head, "--objects", objects, "--evidence", evidence], "need --sandbox"],
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

Deno.test("run-gate --sandbox: a head out of reach, or evidence beside it, runs nothing", async () => {
  const { head, objects, evidence, run } = await sandboxed();
  const unreached = await run(["fast", "--head", head, "--evidence", evidence, "--sandbox"]);
  assertEquals(unreached.code, 3, unreached.stderr);
  assertStringIncludes(
    unreached.stdout,
    `candidate: refused (head-refused: no commit ${head} in reach)`,
  );
  const beside = bashPath(join(dirname(dirname(objects)), "review"));
  await Deno.mkdir(beside);
  const inside = await run([
    "fast",
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

Deno.test("review-untrusted.md's run-gate line runs as written", async () => {
  const doc = await Deno.readTextFile(
    new URL("../../templates/core/skills/task/phases/review-untrusted.md", import.meta.url),
  );
  const line = doc.split("\n").find((l) => l.startsWith("bash .specnaut/scripts/bash/run-gate.sh"));
  const { repo, head, objects, evidence, run } = await sandboxed();
  const values: Record<string, string> = {
    "<fast|full>": "fast",
    '"$BASE_TIP"': repo.main,
    '"$HEAD"': head,
    '"$OBJECTS"': objects,
    '"$LOGS"': evidence,
  };
  const args = (line ?? "").split(" ").slice(2).map((w) => values[w] ?? w);
  assert(args.every((w) => !/[<$"]/.test(w)), `a placeholder this test does not know: ${line}`);
  const r = await run(args);
  assertEquals([r.code, r.calls.length], [0, 3], r.stderr);
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
