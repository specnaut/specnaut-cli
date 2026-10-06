import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Each phase of the chain carries its size gate (#644). Before it, nothing from
 * plan to review read the constitution's size limits, so a file grew past any
 * cap through many small slices, each passing every phase.
 *
 * These pin the gate's presence where a reader of that phase will meet it, not
 * its wording: the wording lives once, in `.specnaut/memory/size-limits.md`.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const read = (p: string) => Deno.readTextFile(`${ROOT}${p}`);
const LIMITS = ".specnaut/memory/size-limits.md";

Deno.test("plan: the template has the mandatory size row and a measured Files touched table", async () => {
  const t = await read("templates/core/specnaut/templates/plan-template.md");
  assert(t.includes("| Size limits ("), "mandatory size row");
  assert(t.includes("### Files touched"), "Files touched table");
  assert(t.includes("| File | Lines now | Lines after (est.) | Over target? |"), "table shape");
  assert(t.includes("measured with `wc -l`"), "Lines now is measured");
  assert(
    t.includes("A size violation cannot be accepted here"),
    "complexity tracking refuses size",
  );
});

Deno.test("plan: the phase points at the size gate", async () => {
  assert((await read("templates/core/skills/specnaut/phases/plan.md")).includes(LIMITS));
});
