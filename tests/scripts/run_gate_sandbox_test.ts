// `run-gate.sh <tier> --base <rev> … --head <sha> --objects <dir> --evidence <dir> --sandbox`: each
// command of the base's gates.yml runs on the head's exported copy through `specnaut sandbox exec`,
// never here, and is judged by its exit code alone. A `specnaut` first on the PATH records each
// call and exits as told, so no sandbox is needed; the project's own commands write a mark when
// they run here, so a run that bypassed the sandbox leaves one. Refusals: the sibling file.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname } from "@std/path";
import { ALWAYS, GATES, SUITE, WEB_ONLY } from "./gate_impact_fixture.ts";
import { evidenceOf, sandboxed } from "./run_gate_sandbox_fixture.ts";
import { blob, commit, mktree } from "../helpers/git_fixture.ts";

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
  const { repo, run, full } = await sandboxed({ declaration: null });
  const r = await run(["fast", "--base", repo.main, ...full]);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.marks, [], "a command ran on the host");
  assertEquals(r.calls.map((c) => c.at(-1)), [SUITE, WEB_ONLY, ALWAYS]);
  for (const rc of [125, 127]) {
    const notRun = await run(["fast", "--base", repo.main, ...full], rc);
    assertEquals(notRun.code, 125, notRun.stdout);
    assertEquals(notRun.calls.length, 1);
    assertStringIncludes(
      notRun.stderr,
      `the fast gate did not run at command 1/3 (exit ${rc}): ${SUITE}`,
    );
  }
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

Deno.test("run-gate --sandbox: a tier not declared is NOT RUN, with a declaration or without", async () => {
  for (const declaration of [undefined, null]) {
    const { repo, run, full } = await sandboxed({ declaration, gates: "full_gate:\n  - echo x\n" });
    const r = await run(["fast", "--base", repo.main, ...full]);
    assertEquals([r.code, r.calls], [125, []], r.stdout + r.stderr);
    assertStringIncludes(r.stdout + r.stderr, "NOT RUN, never a pass");
    const bare = await repo.commit({}, [".specnaut/gates.yml"]);
    const absent = await run(["fast", "--base", bare, ...full]);
    assertEquals([absent.code, absent.calls], [125, []], absent.stdout + absent.stderr);
  }
});

Deno.test("run-gate --sandbox: the tier is the base's; an edit to the work tree's gates.yml runs nothing", async () => {
  for (const declaration of [undefined, null]) {
    const { repo, run, full } = await sandboxed({ declaration });
    await Deno.writeTextFile(`${repo.root}/.specnaut/gates.yml`, "fast_gate:\n  - echo edited\n");
    const r = await run(["fast", "--base", repo.main, ...full]);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(r.calls.map((c) => c.at(-1)), [SUITE, WEB_ONLY, ALWAYS], String(declaration));
  }
});

Deno.test("run-gate --sandbox: no --base, one naming no commit, or the head's, runs nothing", async () => {
  const { head, run, full } = await sandboxed({ declaration: null });
  const none = await run(["fast", ...full]);
  assertEquals([none.code, none.calls], [2, []], none.stderr);
  assertStringIncludes(none.stderr, "--sandbox needs --base <rev>");
  const missing = await run(["fast", "--base", "no-such-branch", ...full]);
  assertEquals([missing.code, missing.calls], [3, []], missing.stderr);
  assertStringIncludes(missing.stderr, "no-such-branch names no commit");
  const own = await run(["fast", "--base", head, ...full]);
  assertEquals([own.code, own.calls], [3, []], own.stderr);
  assertStringIncludes(own.stderr, `${head} names no commit of this repository`);
});

Deno.test("run-gate --sandbox: a base git cannot list is refused with git's reason, not read as none", async () => {
  const { repo, run, full } = await sandboxed({ declaration: null });
  const tree = await mktree(repo.root, [["100644", "only-here", await blob(repo.root, "gone\n")]]);
  const base = await commit(repo.root, tree);
  await Deno.remove(`${repo.root}/.git/objects/${tree.slice(0, 2)}/${tree.slice(2)}`);
  const r = await run(["fast", "--base", base, ...full]);
  assertEquals([r.code, r.calls], [3, []], r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `base-refused: git ls-tree ${base} failed: `);
  assertStringIncludes(r.stderr, "not a tree object");
});

Deno.test("run-gate --sandbox: the base's toolchain folders are each run's --toolchain; the work tree's are not", async () => {
  const gates = `${GATES}toolchain:\n  - /opt/go/bin\n  - ~/.deno/bin\n`;
  const { repo, head, run, full } = await sandboxed({ declaration: null, gates });
  await Deno.writeTextFile(`${repo.root}/.specnaut/gates.yml`, `${GATES}toolchain:\n  - /etc\n`);
  const r = await run(["fast", "--base", repo.main, ...full]);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  const folders = `/opt/go/bin:${Deno.env.get("HOME")}/.deno/bin`;
  for (const call of r.calls) {
    assertEquals(call.slice(0, 5), ["sandbox", "exec", head, "--toolchain", folders]);
    assertEquals(call[5], "--log");
  }
  assertEquals(r.calls.length, 3);
});
