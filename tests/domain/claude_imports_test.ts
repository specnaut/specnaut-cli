import { assertEquals } from "@std/assert";
import {
  importReasons,
  importsFrom,
  type ImportSides,
  importsIn,
  importTarget,
} from "../../src/domain/claude_imports.ts";
import { INSTRUCTION_REASON } from "../../src/domain/instruction_head.ts";
import { REASON } from "../../src/domain/script_trust.ts";

/** The `@path` imports of a CLAUDE.md: which are read, where they lead, how a target is judged. */

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("imports are read from prose, never from a fenced block or a code span", () => {
  const text =
    "See @docs/rules.md and @./a.md.\n```\n@docs/secret.md\n```\nRun `see @b.md` x@c.md\n@d.md";
  assertEquals(importsIn(text), ["docs/rules.md", "./a.md.", "./a.md", "d.md"]);
  assertEquals(importsIn("~~~\n@x.md\n~~~\n@y.md\r\n"), ["y.md"]);
});

Deno.test("CLAUDE.md and CLAUDE.local.md import, in any folder and letter case; AGENTS.md does not", () => {
  const paths = ["CLAUDE.md", "src/claude.local.md", "../CLAUDE.md", "AGENTS.md", "docs/x.md"];
  assertEquals(paths.map(importsFrom), [true, true, true, false, false]);
});

Deno.test("a target is read relative to the importing file, and the home or an absolute path is out", () => {
  assertEquals(importTarget("CLAUDE.md", "docs/rules.md"), "docs/rules.md");
  assertEquals(importTarget("src/CLAUDE.md", "../shared/rules.md"), "shared/rules.md");
  assertEquals(importTarget("CLAUDE.md", "../shared.md"), "../shared.md");
  assertEquals(importTarget("../CLAUDE.md", "./x/../y.md"), "../y.md");
  assertEquals(importTarget("CLAUDE.md", "~/notes.md"), null);
  assertEquals(importTarget("CLAUDE.md", "/etc/rules.md"), null);
});

Deno.test("an imported file is judged as HEAD commits it against the tip", () => {
  const sides = (head: ImportSides["head"], tip: ImportSides["tip"], mergeBase = tip) => ({
    head,
    tip,
    mergeBase,
  });
  const files = new Map<string, ImportSides>([
    ["a.md", sides(enc("x"), enc("x"))],
    ["b.md", sides(enc("y"), enc("x"))],
    ["c.md", sides(enc("y"), "absent")],
    ["d.md", sides("absent", enc("x"))],
    ["e.md", sides("absent", enc("x"), "absent")],
    ["f.md", sides("absent", "absent")],
    ["g.md", sides("not_regular", "not_regular")],
    ["h.md", sides(enc("x‮"), enc("x"))],
    ["i.md", sides(enc("x"), enc("y"), enc("x"))],
  ]);
  assertEquals(importReasons(files).map((u) => `${u.path} ${u.reason}`), [
    `b.md ${REASON.differs}`,
    `c.md ${REASON.notOnBase}`,
    `d.md ${REASON.missing}`,
    `e.md ${REASON.behind}`,
    `g.md ${REASON.notRegular}`,
    `h.md ${INSTRUCTION_REASON.invisible}: U+202E (line 1)`,
    `i.md ${REASON.behind}`,
  ]);
});
