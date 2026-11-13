// What the boundary check's docs tell a project writing its `forbid:` patterns. grep ends a line
// only at a newline, while a compiler also ends one at a lone CR or a U+2028, so an import after
// such a line end is not where `^` or `$` look: the docs say to leave a pattern unanchored.

import { assertMatch } from "@std/assert";
import { fromFileUrl } from "@std/path";

const DOCS = [
  "templates/core/skills/task/phases/quality-gates.md",
  "plugin/skills/task/phases/quality-gates.md",
  "templates/core/specnaut/scripts/bash/boundary-check.sh",
];

for (const doc of DOCS) {
  Deno.test(`boundary check docs (${doc}): forbid patterns are left unanchored, and why`, async () => {
    const text = (await Deno.readTextFile(fromFileUrl(new URL(`../../${doc}`, import.meta.url))))
      .replace(/\n#?\s*/g, " ");
    assertMatch(text, /unanchored/);
    assertMatch(text, /lone CR or a U\+2028/);
    assertMatch(text, /`\^` (and|or) `\$`/);
  });
}
