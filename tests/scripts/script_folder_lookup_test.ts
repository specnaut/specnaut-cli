import { assert, assertEquals } from "@std/assert";
import { scriptSource } from "./backend_scripts_fixture.ts";

/**
 * land-feature.sh and lfs-push.sh find their own folder with builtins, before any helper can be
 * sourced, so the lookup is a copy in each; this holds the copies equal, from `here=` to the `cd`.
 */

const SCRIPTS = ["land-feature.sh", "lfs-push.sh"];

async function lookup(name: string): Promise<string[]> {
  const path = scriptSource(`../../../specnaut/scripts/bash/${name}`);
  const lines = (await Deno.readTextFile(path)).split(/\r?\n/);
  const at = lines.indexOf("here=${BASH_SOURCE[0]}");
  assert(at !== -1, `${name} has no builtin folder lookup`);
  const end = lines.findIndex((l, i) => i > at && l.startsWith('here=$(CDPATH="" cd '));
  assert(end !== -1, `${name}'s folder lookup has no cd`);
  return lines.slice(at, end + 1);
}

Deno.test("each merge script finds its folder with the same builtin lookup", async () => {
  const [first, ...others] = await Promise.all(SCRIPTS.map(lookup));
  assert(first.some((l) => l.includes("[/\\\\]")), "the lookup does not cut at a backslash");
  for (const [i, copy] of others.entries()) assertEquals(copy, first, SCRIPTS[i + 1]);
});
