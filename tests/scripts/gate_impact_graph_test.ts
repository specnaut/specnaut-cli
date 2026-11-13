// What the change set and the protected paths are read from: the objects their ids name, and
// entries no file name can forge.

import { assertEquals } from "@std/assert";
import { scoped } from "./gate_impact_case.ts";
import { impactRepo, labelled } from "./gate_impact_fixture.ts";
import { TWINS } from "./run_gate_fixture.ts";

for (const twin of TWINS) {
  Deno.test({
    name: `gate impact (${twin}): a protected file whose name holds a newline widens`,
    // A Windows checkout cannot hold such a name.
    ignore: Deno.build.os === "windows",
    fn: async () => {
      const files = { ".specnaut/scripts/bash/a\n100644 blob x\tb.sh": "x\n" };
      const repo = await impactRepo({ files });
      await repo.commit({ "apps/web/a.ts": "changed\n" });
      const r = await repo.gate(twin, ["fast", "--base", repo.main]);
      assertEquals(r.code, 0, r.stdout + r.stderr);
      assertEquals(labelled(r, "fallback"), ["protected-not-regular: .specnaut/scripts/"]);
    },
  });

  Deno.test(`gate impact (${twin}): a replace ref does not change what a base holds`, async () => {
    const repo = await impactRepo();
    const tip = await repo.commit({ "apps/web/a.ts": "changed\n" });
    // Read through the replacement, the base would hold the tip and nothing would differ.
    await repo.git("replace", repo.main, tip);
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "scope"), ["owners web"], r.stdout);
    assertEquals(r.marks, scoped("web"));
  });
}
