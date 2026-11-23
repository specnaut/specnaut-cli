import { assert, assertEquals } from "@std/assert";
import { keptAtHead, NOT_A_FOLDER } from "../../src/domain/instruction_scope.ts";
import { NON_ASCII_REASON } from "../../src/domain/non_ascii_path.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";
import { blob, file, judge, walked } from "./instruction_trust_fixture.ts";

/**
 * A disk that folds case beyond ASCII can open an instruction file under a name spelled with a
 * code point outside it. Such a name is kept at HEAD whenever its ASCII skeleton is in scope, and
 * named unless the tip holds it as written: it is never taken for the name it may stand for.
 */

// U+017F LATIN SMALL LETTER LONG S and U+0131 LATIN SMALL LETTER DOTLESS I, in place of s and i.
const LONG_S = "docs/con\u017ftitution.md";
const DOTLESS_I = ".claude/sett\u0131ngs.json";
const IN_ROOT = ".claude/\u017fkills/task/SKILL.md";

Deno.test("HEAD's listing keeps a name whose skeleton is an instruction path, U+017F and U+0131", () => {
  for (
    const kept of [LONG_S, DOTLESS_I, IN_ROOT, "src/\u00c4GENTS.md", "AGENTS.overr\u0131de.md"]
  ) {
    assert(keptAtHead(kept), kept);
  }
  for (const dropped of ["docs/caf\u00e9.md", "src/\u0131.ts", "notes/\u017f.md"]) {
    assert(!keptAtHead(dropped), dropped);
  }
});

Deno.test("a name holding U+017F or U+0131 that the tip lacks is named, never matched", () => {
  for (const path of [LONG_S, DOTLESS_I, IN_ROOT]) {
    assertEquals(judge({ tree: walked(), tip: [], head: [blob(path)] }), [
      `${path} ${NON_ASCII_REASON}`,
    ], path);
  }
});

Deno.test("a name holding a non-ASCII code point inside a root is named until the tip holds it", () => {
  const path = ".claude/skills/caf\u00e9/SKILL.md";
  assertEquals(judge({ tree: walked(file(path)), tip: [], head: [blob(path)] }), [
    `${path} ${NON_ASCII_REASON}`,
  ]);
  const tip = [blob(path)];
  assertEquals(judge({ tree: walked(file(path)), tip, head: tip }), ["trusted"]);
});

Deno.test("a link HEAD holds where its skeleton names a root's folder is not one, tip or not", () => {
  const link: BaseEntry = { kind: "link", path: ".\u017fpecnaut", target: "elsewhere" };
  assert(keptAtHead(link.path));
  for (const tip of [[], [link]]) {
    assertEquals(judge({ tree: walked(), tip, head: [link] }), [`${link.path} ${NOT_A_FOLDER}`]);
  }
});

Deno.test("a name holding U+212A, which lower-cases to an ASCII k, is named, never matched", () => {
  const path = ".claude/skills/tas\u212a/SKILL.md";
  assertEquals(judge({ tree: walked(), tip: [], head: [blob(path)] }), [
    `${path} ${NON_ASCII_REASON}`,
  ]);
});
