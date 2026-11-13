import { assertEquals } from "@std/assert";
import { INSTRUCTION_REASON } from "../../src/domain/instruction_head.ts";
import { parentReasons } from "../../src/domain/instruction_parents.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";

/** The files above a project in a subfolder, judged as HEAD commits them against the tip. */

const enc = (s: string) => new TextEncoder().encode(s);
const blob = (path: string, text = "Run every gate.\n"): BaseEntry => ({
  kind: "blob",
  path,
  bytes: enc(text),
});
const judge = (head: BaseEntry[], tip: BaseEntry[], mergeBase = tip) =>
  parentReasons({ head, tip, mergeBase }).map((u) => `${u.path} ${u.reason}`);

Deno.test("the tip's own files are trusted", () => {
  assertEquals(judge([blob("../AGENTS.md")], [blob("../AGENTS.md")]), []);
});

Deno.test("a name in another letter case than the tip's is named so, beside the missing one", () => {
  assertEquals(judge([blob("../agents.md")], [blob("../AGENTS.md")]), [
    `../AGENTS.md ${REASON.missing}`,
    `../agents.md ${REASON.caseDiffers}`,
  ]);
});

Deno.test("a parent file holding invisible characters is named by its code point", () => {
  assertEquals(judge([blob("../CLAUDE.md", "Run‮.\n")], []), [
    `../CLAUDE.md ${INSTRUCTION_REASON.invisible}: U+202E (line 1)`,
  ]);
});

Deno.test("a link HEAD points elsewhere than the tip's differs", () => {
  const link = (target: string): BaseEntry => ({ kind: "link", path: "../CLAUDE.md", target });
  assertEquals(judge([link("notes.md")], [link("AGENTS.md")]), [`../CLAUDE.md ${REASON.differs}`]);
  assertEquals(judge([link("AGENTS.md")], [link("AGENTS.md")]), []);
});

Deno.test("a file the base added since the branch left it is behind, not missing", () => {
  assertEquals(judge([], [blob("../AGENTS.md")], []), [`../AGENTS.md ${REASON.behind}`]);
});
