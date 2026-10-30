import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * `set-field.sh`'s exit codes have one prose home: the product-owner's classification contract
 * (cli#679). They were written out in three places — `task/backlog.md` twice and `task/groom.md`
 * — and the copies had already drifted (one knew exit `2`, another did not). The script header
 * is the source; the PO contract is the one place an agent reads them from.
 */

const CORE = fromFileUrl(new URL("../../templates/core/", import.meta.url));
const flat = (rel: string) => Deno.readTextFileSync(`${CORE}${rel}`).replace(/\s+/g, " ");
const CONTRACT = "the product-owner's classification contract";

Deno.test("the PO classification contract carries every set-field.sh exit code", () => {
  const po = flat("agents/product-owner.md");
  const at = po.indexOf("## Mandatory classification contract");
  assert(at >= 0, "the PO agent has no classification contract");
  const contract = po.slice(at);
  for (const code of ["`10`", "`11`", "`12`", "`13`", "`2`"]) {
    assertStringIncludes(contract, code, `the contract does not say what ${code} means`);
  }
});

Deno.test("backlog.md and groom.md point at the PO contract instead of restating the codes", () => {
  for (const rel of ["skills/task/backlog.md", "skills/task/groom.md"]) {
    const doc = flat(rel);
    assertStringIncludes(doc, CONTRACT, `${rel} does not point at the contract`);
    // Fragments of a set-field.sh code table — groom-columns.sh has an exit `13` of its own.
    const copies = ["`12` = ", "`13` = ", "`12` / `13`", "`10` / `11`", "`10`/`11`", "IssueType>"];
    for (const copy of copies) {
      assertEquals(doc.includes(copy), false, `${rel} restates a set-field.sh exit code: ${copy}`);
    }
  }
});
