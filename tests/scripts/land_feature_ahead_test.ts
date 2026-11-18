import { assert, assertEquals } from "@std/assert";
import { git, run, sandbox } from "./git_sandbox.ts";

/**
 * Without a scripts digest, `_verifier.sh` lets one reason through to the landing's own exit 6: a
 * local base ahead of origin, matched by the whole `UNTRUSTED` line. That line is the binary's
 * wording, so it is read here from the CLI run from source, never written by hand: a change to
 * either spelling turns this red, where it would otherwise turn every such landing into a 13.
 */

const VERIFIER = new URL(
  "../../templates/core/specnaut/scripts/bash/_verifier.sh",
  import.meta.url,
);

Deno.test("the local-ahead line land-feature.sh lets through is the one the binary prints", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("l", "l\n", "chore: local only");
    await git(sb.work, "switch", "--quiet", "-c", "feature", "origin/main");
    await sb.commit("f", "x\n", "feat(7): a feature");
    const source = await Deno.readTextFile(VERIFIER);
    const literal = /grep -vxF "(UNTRUSTED [^"]+)"/.exec(source)?.[1];
    assert(literal, "_verifier.sh no longer matches a whole UNTRUSTED line");
    const out = await run("bash", ["-c", "specnaut verify-scripts"], sb.work);
    const names = /^NAMES_FILE (.+)$/m.exec(out.stdout)?.[1];
    if (names) await Deno.remove(names);
    const untrusted = out.stdout.split("\n").filter((l) => l.startsWith("UNTRUSTED "));
    assertEquals(untrusted, [literal.replaceAll("$base", "main")], out.stdout + out.stderr);
    const landed = await sb.script("land-feature.sh");
    assertEquals(landed.code, 6, landed.stderr);
  } finally {
    await sb.cleanup();
  }
});
