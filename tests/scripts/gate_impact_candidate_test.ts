// FR-001, FR-002, FR-014: when the flags change nothing, how they are refused when used
// wrongly, and what an absent jq does.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { pathWithoutJq } from "../templates/hooks/hook_path.ts";
import type { Sandbox } from "../templates/hooks/hook_sandbox.ts";
import { pwshRunsOnCi } from "./epic_repo.ts";
import { impactRepo, labelled } from "./gate_impact_fixture.ts";
import { gateProject, runGate, TWINS } from "./run_gate_fixture.ts";

pwshRunsOnCi("gate impact");

for (const twin of TWINS) {
  Deno.test(`gate impact (${twin}): a flag with no declaration is the bare run, to the byte`, async () => {
    const repo = await impactRepo({ declaration: null });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const bare = await repo.gate(twin, ["fast"]);
    assertEquals(bare.code, 0, bare.stderr);
    assertStringIncludes(bare.stdout, "3 of 3 command(s)");
    for (
      const flags of [["--base", repo.main], ["--base", ""], ["--base", "no-such"], [
        "--refs-stdin",
      ]]
    ) {
      const r = await repo.gate(twin, ["fast", ...flags], { stdin: "not a push line\n" });
      assertEquals(r.stdout, bare.stdout, flags.join(" "));
      assertEquals(r.stderr, bare.stderr, flags.join(" "));
      assertEquals(r.code, bare.code, flags.join(" "));
      assertEquals(r.marks, bare.marks);
    }
  });

  Deno.test(`gate impact (${twin}): with no declaration, a dirty tree is not refused`, async () => {
    const repo = await impactRepo({ declaration: null });
    await Deno.writeTextFile(join(repo.root, "untracked.txt"), "x\n");
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "3 of 3 command(s)");
    assertEquals(r.report, []);
  });

  Deno.test(`gate impact (${twin}): outside any repository with no declaration, the flag changes nothing`, async () => {
    const root = await gateProject("fast_gate:\n  - echo hello\n");
    const bare = await runGate(twin, root, ["fast"]);
    const flagged = await runGate(twin, root, ["fast", "--base", "main"]);
    assertEquals(flagged.stdout, bare.stdout);
    assertEquals(flagged.code, 0);
  });

  Deno.test(`gate impact (${twin}): bare never reads the declaration`, async () => {
    const repo = await impactRepo({ declaration: "{ not json" });
    await Deno.writeTextFile(join(repo.root, "untracked.txt"), "x\n");
    const r = await repo.gate(twin, ["fast"]);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.report, []);
    assertEquals(r.marks, ["suite unset", "web-only unset", "always unset"]);
    assertEquals(await repo.adapterRuns(), []);
  });

  Deno.test(`gate impact (${twin}): flags used wrongly are usage errors`, async () => {
    const repo = await impactRepo();
    for (
      const args of [
        ["fast", "--base"],
        ["fast", "--base", "-x"],
        ["fast", "--base", "--refs-stdin"],
        ["fast", "--base", "a", "--base", "b"],
        ["fast", "--base", "a", "--refs-stdin"],
        ["fast", "--refs-stdin", "--refs-stdin"],
        ["fast", "--bse", "a"],
        ["fast", "stray"],
      ]
    ) {
      const r = await repo.gate(twin, args);
      assertEquals(r.code, 2, args.join(" "));
      assertStringIncludes(r.stderr, "--refs-stdin", args.join(" "));
      assertEquals(r.marks, [], args.join(" "));
    }
  });
}

Deno.test({
  name: "gate impact (bash): jq absent runs the full tier and names why",
  fn: async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate("bash", ["fast", "--base", repo.main], {
      env: { PATH: await pathWithoutJq({ dir: repo.outside } as Sandbox) },
    });
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "fallback"), ["jq-absent"]);
    assertEquals(r.marks, ["suite unset", "web-only unset", "always unset"]);
    assertEquals(labelled(r, "evidence"), ["unwritten (jq-absent)"]);
    assertEquals(await repo.adapterRuns(), []);
  },
});
