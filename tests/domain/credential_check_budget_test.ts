import { assert } from "@std/assert";
import { credentialKind } from "../../src/domain/cloud/credential_check.ts";

/**
 * A long line costs time in proportion to its length, never to its square: every run
 * a pattern repeats is bounded in `_secret_patterns.txt`, so neither reader can be
 * made to backtrack over a megabyte from every position in it.
 */

const MB = 1 << 20;
const fill = (unit: string) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);

/** One line per shape that once made a pattern rescan the rest of the line. */
const SHAPES: Record<string, string> = {
  "a scheme's letters": fill("a"),
  "schemes with no userinfo": fill("a://"),
  "userinfo with no @": fill("a://b:c"),
  "a keyword's suffix": fill("token"),
  "a JWT header with no dot": fill("eyJ"),
  "a JWT header, a dot, no payload": `eyJ${fill("a")}.`,
};

for (const [shape, line] of Object.entries(SHAPES)) {
  Deno.test(`a 1 MB line of ${shape} is judged within the budget`, () => {
    const start = performance.now();
    credentialKind(line);
    const ms = performance.now() - start;
    assert(ms < 1500, `${shape}: ${Math.round(ms)} ms`);
  });
}
