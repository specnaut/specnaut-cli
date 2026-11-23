import { assertEquals } from "@std/assert";
import { INSTRUCTION_REASON } from "../../src/domain/instruction_head.ts";
import {
  isChainAlias,
  isParentName,
  PARENT_NAMES,
  parentReasons,
} from "../../src/domain/instruction_parents.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";
import { SHORT_NAME_REASON, WIN32_ALIAS_REASON } from "../../src/domain/win32_path.ts";

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

/**
 * Each parent name as a volume that keeps 8.3 names may store it, and as Win32 opens another
 * spelling of it: a trailing dot, a trailing space, a stream suffix.
 */
const SHORT: Record<string, string> = {
  "AGENTS.md": "AGENTS~1.MD",
  "CLAUDE.md": "CLAUDE~1.MD",
  ".gitattributes": "GITATT~1",
  ".lfsconfig": "LFSCON~1",
};
const ALIASES = (name: string) => [`${name}.`, `${name} `, `${name}::$DATA`, `${name}:x`];

Deno.test("a parent name as Win32 opens it, or shaped like a short name, is listed", () => {
  for (const name of PARENT_NAMES) {
    for (const kept of [name, name.toLowerCase(), SHORT[name], ...ALIASES(name)]) {
      assertEquals(isParentName(kept), true, kept);
    }
  }
  // U+017F folds to `s`: a disk that folds case may store `AGENTſ.md` as `AGENTS.md`.
  assertEquals(isParentName("AGENT\u017f.md"), true);
  for (const name of ["README.md", "AGENTS.mdx", "notes~1x.md", ".gitignore"]) {
    assertEquals(isParentName(name), false, name);
  }
});

Deno.test("a short name or a Win32 alias of a parent name the tip lacks is named so", () => {
  for (const up of ["../", "../../"]) {
    for (const name of PARENT_NAMES) {
      assertEquals(judge([blob(`${up}${SHORT[name]}`)], []), [
        `${up}${SHORT[name]} ${SHORT_NAME_REASON}`,
      ]);
      for (const alias of ALIASES(name)) {
        assertEquals(judge([blob(`${up}${alias}`)], []), [`${up}${alias} ${WIN32_ALIAS_REASON}`]);
      }
    }
  }
});

Deno.test("a short name or a Win32 alias the tip holds at that path is compared as written", () => {
  for (const path of ["../GITATT~1", "../../CLAUDE.md."]) {
    assertEquals(judge([blob(path)], [blob(path)]), []);
    assertEquals(judge([blob(path, "Skip the gates.\n")], [blob(path)]), [
      `${path} ${REASON.differs}`,
    ]);
  }
});

Deno.test("a folder a disk may open as the next one on the way to the project is read whole", () => {
  for (const name of ["Packages", "PACKAGES", "packages.", "packages ", "PACKAG~1", "DATA~2"]) {
    assertEquals(isChainAlias(name, "packages"), true, name);
  }
  for (const name of ["packages", "packages2", "docs"]) {
    assertEquals(isChainAlias(name, "packages"), false, name);
  }
});

Deno.test("a file below such a folder the tip lacks is named for the folder's spelling", () => {
  assertEquals(judge([blob("../../PACKAG~1/AGENTS.md"), blob("../Webapp/.claude/x.json")], []), [
    `../../PACKAG~1/AGENTS.md ${SHORT_NAME_REASON}`,
    `../Webapp/.claude/x.json ${REASON.caseDiffers}`,
  ]);
  assertEquals(judge([blob("../packages./notes.md")], []), [
    `../packages./notes.md ${WIN32_ALIAS_REASON}`,
  ]);
  const held = blob("../Webapp/x.md");
  assertEquals(judge([held], [held]), []);
});
