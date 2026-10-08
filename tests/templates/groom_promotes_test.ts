import { assert, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../src/application/ports.ts";

/**
 * #654 — grooming ends with a promotion, and the agent that grooms is told so.
 *
 * Three places defined grooming and only one of them moved the item: the
 * product-owner's own `/board groom` contract said "review, re-estimate,
 * classify" and never "promote", and the PO follows its own contract — so
 * groomed items stayed in `Backlog`. The rule now lives in that contract, and
 * this asserts it on what every harness actually ships to its grooming agent,
 * not on the Claude source alone: the report came from a Codex session.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const RULE = "It ends with a promotion";

for (const h of HARNESSES) {
  Deno.test(`${h.key}: the grooming agent's own contract carries the promotion rule`, () => {
    const opts = everyBundleOption().find((o) => o.backlogBackend === "github")!;
    const shipped = Object.entries(h.mapBundle(CORE_BUNDLE, opts))
      .filter(([path]) => /product-owner/.test(path) && !/memory/.test(path));
    assert(shipped.length > 0, `${h.key} ships no product-owner agent`);
    for (const [path, file] of shipped) {
      assertStringIncludes((file as { content: string }).content, RULE, path);
    }
  });
}

Deno.test("groom.md resolves the columns, asks once, and promotes to the resolved column", async () => {
  const groom = await Deno.readTextFile(`${ROOT}templates/core/skills/board/groom.md`);
  assertStringIncludes(groom, "groom-columns.sh");
  assertStringIncludes(groom, "ask the user **once**");
  assertStringIncludes(groom, "groom-columns.sh --set ready_column <column|none>");
  assertStringIncludes(groom, '`move.sh <num> "$READY"`');
  // The column is the board's, not a hard-coded `Ready`.
  assert(!groom.includes("**Promote to `Ready`**"), "groom.md still hard-codes the ready column");
});

Deno.test("the groom report carries the columns and every failed promotion", async () => {
  const report = await Deno.readTextFile(`${ROOT}templates/core/skills/board/groom-report.md`);
  assertStringIncludes(report, "Columns:    intake=<name>  ready=<name | none");
  assertStringIncludes(report, "⚠ promotion failed — groomed but still in <intake>:");
});
