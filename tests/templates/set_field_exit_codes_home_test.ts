import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * `set-field.sh`'s exit codes have one home: the script's own header (cli#679). They were written
 * out in three places — `task/backlog.md` twice and `task/groom.md` — and the copies had already
 * drifted. Since the product owner stopped running scripts, the one reader that acts on a code is
 * the executor, `_apply_plan.sh`, which takes a label on exit 10 alone; every doc points at the
 * header instead of restating a code.
 */

const CORE = fromFileUrl(new URL("../../templates/core/", import.meta.url));
const SCRIPTS = `${CORE}skills/task/scripts/`;
const flat = (rel: string) => Deno.readTextFileSync(`${CORE}${rel}`).replace(/\s+/g, " ");

Deno.test("set-field.sh's header carries every exit code", () => {
  const header = Deno.readTextFileSync(`${SCRIPTS}github/set-field.sh`).split("set -euo")[0];
  for (const code of ["10", "11", "12", "13", "2"]) {
    assert(new RegExp(`^#\\s+${code}\\s+\\S`, "m").test(header), `the header lacks exit ${code}`);
  }
});

Deno.test("the executor takes a label on set-field.sh's exit 10, and on no other", () => {
  const body = Deno.readTextFileSync(`${SCRIPTS}_apply_plan.sh`);
  assertStringIncludes(body, `[ "$rc" != 10 ] || lbl=$(fallback_label "$axis" "$value")`);
  assertEquals(/"\$rc" != 1[1-3]/.test(body), false, "another exit takes the label");
});

Deno.test("the PO, backlog.md and groom.md restate no set-field.sh exit code", () => {
  assertStringIncludes(flat("skills/task/backlog.md"), "its header: the axes and exit codes");
  for (const rel of ["agents/product-owner.md", "skills/task/backlog.md", "skills/task/groom.md"]) {
    const doc = flat(rel);
    // Fragments of a set-field.sh code table — groom-columns.sh has an exit `13` of its own.
    const copies = ["`12` = ", "`13` = ", "`10` = ", "`12` / `13`", "`10` / `11`", "IssueType>"];
    for (const copy of copies) {
      assertEquals(doc.includes(copy), false, `${rel} restates a set-field.sh exit code: ${copy}`);
    }
  }
});
