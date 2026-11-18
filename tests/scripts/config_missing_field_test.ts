import { assertEquals, assertMatch } from "@std/assert";
import { scriptSource } from "./backend_scripts_fixture.ts";

/**
 * The github, gitlab and cloud `_config.sh` each refuse an unfilled field with
 * the same four-line loop (cli#804). It stays a copy in each file, as
 * `jq_lf` and `require_issue_number` do: a shared sourced helper would be one
 * more installed file per backend for four lines. So this test holds the
 * copies equal. Only the fields and the hint on how to fix them are the
 * backend's own, and each field is read from the variable of its name.
 */

const BACKENDS = ["github", "gitlab", "cloud"];

/** The loop's four lines in `backend`'s `_config.sh`, from its `for _f in` line. */
async function loop(backend: string): Promise<string[]> {
  const lines = (await Deno.readTextFile(scriptSource(`${backend}/_config.sh`))).split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith("for _f in "));
  return at === -1 ? [] : lines.slice(at, at + 4);
}

Deno.test("every backend's _config.sh refuses an unfilled field with the same loop", async () => {
  const [first, ...others] = await Promise.all(BACKENDS.map(loop));
  assertEquals(first.length, 4, "github/_config.sh has no `for _f in` loop");
  for (const [i, copy] of others.entries()) {
    const backend = BACKENDS[i + 1];
    assertEquals([copy[1], copy[3]], [first[1], first[3]], `${backend} differs from github`);
  }
  for (const [i, [fields, , hint]] of [first, ...others].entries()) {
    assertMatch(fields, /^for _f in( "[a-z_]+:\$[A-Z_]+")+; do$/, BACKENDS[i]);
    for (const [, name, variable] of fields.matchAll(/"([a-z_]+):\$([A-Z_]+)"/g)) {
      assertEquals(variable, name.toUpperCase(), `${BACKENDS[i]}: ${name}`);
    }
    assertMatch(hint, /^ {4}echo ".+" >&2; exit 2; }$/, BACKENDS[i]);
  }
});
